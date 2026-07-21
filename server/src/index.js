import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import expensesRoutes, { purgeExpiredTrash } from './routes/expenses.routes.js';
import adminRoutes from './routes/admin.routes.js';
import appRoutes from './routes/app.routes.js';
import billingRoutes from './routes/billing.routes.js';
import exportRoutes from './routes/export.routes.js';
import { purgeUnactivatedAccounts, runBillingReminders } from './jobs/billingJobs.js';
import pool, { ensureSchema } from './db.js';
import { tenantStore, contextFor, listTenants } from './tenant/tenants.js';
import {
  tenantMiddleware,
  companyPage,
  tenantSelect,
  tenantClear,
  tenantCurrent,
} from './tenant/middleware.js';
import { TENANT_COOKIE_NAME } from './tenant/cookies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

// Stripe requires the raw request body to verify webhook signatures, so this
// must be parsed before the global express.json() touches it.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cookieParser());
if (!isProd) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
}

// Tenant gate: /company (+ its tiny API) resolve with no tenant at
// all; every other route runs behind tenantMiddleware, which picks the
// tenant from the hub's X-Tenant-Code header or the signed fallback
// cookie and scopes the rest of the request (DB pool, uploads dir) to
// it. See tenant/middleware.js for the full resolution order.
app.get('/company', companyPage);
app.post('/api/tenant-select', tenantSelect);
app.post('/api/tenant-clear', tenantClear);
app.get('/api/tenant-current', tenantCurrent);

// Public marketing page. Two audiences hit this with no tenant resolved:
//
//   1. Mike's App Hub's own server-side scraper (fetchAndStripExternalPage),
//      which pulls this page's raw HTML with plain fetch() (no JS) to build
//      the /apps/taxify listing. It identifies itself with the
//      x-central-api-key header — for that caller we serve the bare static
//      file below, since anything else would recurse (see next point).
//   2. A real visitor landing on this URL directly (not through the hub, no
//      tenant cookie/header). For them we transparently proxy the hub's own
//      /apps/taxify page — the exact HTML the hub wraps around this same
//      static file (header, "Need help?" widget, footer) — so this URL and
//      the hub listing page render identically. Falls back to the bare
//      static file if the hub is unreachable so the site still works
//      standalone.
const HUB_ORIGIN = process.env.APPHUB_ORIGIN || 'https://mikesapphub.com';
const APPHUB_PRODUCT_SLUG = process.env.APPHUB_PRODUCT_SLUG || 'taxify';
const LANDING_HTML_PATH = path.join(__dirname, '..', '..', 'landing.html');

app.get(['/', '/landing'], async (req, res, next) => {
  if (req.headers['x-tenant-code'] || req.cookies?.[TENANT_COOKIE_NAME]) return next();

  // Only a real top-level browser navigation gets the hub-proxy treatment
  // below. Everything else — the hub's own scraper (x-central-api-key),
  // curl, or any other non-browser caller — gets the bare static file.
  // This is also what breaks the fetch loop: our own outgoing fetch() to
  // the hub never sends Sec-Fetch-Mode (only real browsers do), so if the
  // hub's own fetch back to us ever lands here, it fails this check and
  // serves the static file instead of proxying again — independent of
  // whether the hub's x-central-api-key is even configured.
  const isBrowserNavigation = req.headers['sec-fetch-mode'] === 'navigate' && !req.headers['x-central-api-key'];
  if (!isBrowserNavigation) return res.sendFile(LANDING_HTML_PATH);

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    let html;
    try {
      const r = await fetch(`${HUB_ORIGIN}/apps/${APPHUB_PRODUCT_SLUG}`, { signal: ac.signal });
      if (!r.ok) throw new Error(`hub returned HTTP ${r.status}`);
      html = await r.text();
    } finally {
      clearTimeout(timer);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('[landing] hub proxy failed, falling back to static page:', err.message);
    res.sendFile(LANDING_HTML_PATH);
  }
});

app.use(tenantMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/app', appRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/export', exportRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.name === 'MulterError' || err?.message === 'Unsupported file type') {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (isProd) {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use('/downloads', express.static(path.join(clientDist, 'downloads'), {
      setHeaders: (res) => res.set('Cache-Control', 'no-store'),
    }));
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
}

// Every tenant has its own database, so schema migrations and the
// scheduled jobs below run once per active tenant, each inside a
// tenantStore context so pool.query (via the proxyPool in db.js)
// reaches that tenant's own database.
async function forEachTenant(label, fn) {
  let tenants;
  try {
    tenants = await listTenants();
  } catch (err) {
    console.error(`[${label}] could not read mike_apphub:`, err.message);
    return;
  }
  for (const tenant of tenants) {
    try {
      await tenantStore.run(contextFor(tenant), () => fn(tenant));
    } catch (err) {
      console.error(`[${label}] tenant "${tenant.code}" failed:`, err.message);
    }
  }
}

try {
  await forEachTenant('bootstrap', async (tenant) => {
    console.log(`[bootstrap] tenant "${tenant.code}": applying schema`);
    await ensureSchema();
  });
} catch (err) {
  console.error('Failed to run startup schema migrations against tenant databases.');
  console.error(err);
  process.exit(1);
}

forEachTenant('recycle-bin-purge', () => purgeExpiredTrash(pool))
  .catch((err) => console.error('Failed to purge expired recycle bin entries', err));
setInterval(() => {
  forEachTenant('recycle-bin-purge', () => purgeExpiredTrash(pool))
    .catch((err) => console.error('Failed to purge expired recycle bin entries', err));
}, 60 * 60 * 1000);

forEachTenant('unactivated-purge', () => purgeUnactivatedAccounts(pool))
  .catch((err) => console.error('Failed to purge unactivated accounts', err));
setInterval(() => {
  forEachTenant('unactivated-purge', () => purgeUnactivatedAccounts(pool))
    .catch((err) => console.error('Failed to purge unactivated accounts', err));
}, 60 * 60 * 1000);

forEachTenant('billing-reminders', () => runBillingReminders(pool))
  .catch((err) => console.error('Failed to run billing reminders', err));
setInterval(() => {
  forEachTenant('billing-reminders', () => runBillingReminders(pool))
    .catch((err) => console.error('Failed to run billing reminders', err));
}, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Taxify server listening on http://localhost:${PORT}`);
});
