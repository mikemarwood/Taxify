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
import taxYearRoutes from './routes/taxYears.routes.js';
import deductionRoutes from './routes/deductions.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import entityRoutes from './routes/entities.routes.js';
import { purgeUnactivatedAccounts, runBillingReminders } from './jobs/billingJobs.js';
import { runRecurringExpenses } from './jobs/expenseJobs.js';
import { runTaxReminders } from './jobs/taxReminders.js';
import pool, { ensureSchema } from './db.js';
import { migrateReceiptFolders } from './migrations/receiptFolders.js';
import { migrateCategoriesByYear } from './migrations/categoriesByYear.js';
import { migrateCurrencyBase } from './migrations/currencyBase.js';
import { migrateEntities } from './migrations/entities.js';
import { migrateAccountantInvites } from './migrations/accountantInvites.js';
import { closeExpiredAssignments } from './auth/accountants.js';
import { closeExpiredInvites } from './auth/accountantInvites.js';
import { notify } from './lib/notify.js';
import { sendAccountantInviteLapsedEmail } from './lib/mailer.js';

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

// Public marketing page. Two audiences hit this:
//
//   1. Mike's App Hub's own server-side scraper (fetchAndStripExternalPage),
//      which pulls this page's raw HTML with plain fetch() (no JS) to build
//      the /apps/taxify listing. It identifies itself with the
//      x-central-api-key header — for that caller we serve the bare static
//      file below, since anything else would recurse (see next point).
//   2. A real visitor landing on this URL directly. For them we
//      transparently proxy the hub's own /apps/taxify page — the exact HTML
//      the hub wraps around this same static file (header, "Need help?"
//      widget, footer) — so this URL and the hub listing page render
//      identically. Falls back to the bare static file if the hub is
//      unreachable so the site still works standalone.
const HUB_ORIGIN = process.env.APPHUB_ORIGIN || 'https://mikesapphub.com';
const APPHUB_PRODUCT_SLUG = process.env.APPHUB_PRODUCT_SLUG || 'taxify';
const LANDING_HTML_PATH = path.join(__dirname, '..', '..', 'landing.html');

async function serveLandingPage(req, res) {
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
}

app.get('/landing', serveLandingPage);

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/app', appRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/tax-years', taxYearRoutes);
app.use('/api/deductions', deductionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/entities', entityRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Multer's own errors (file too large, too many files) and anything thrown
  // deliberately with a status are safe to show — they describe a decision the
  // caller can act on. Everything else is a fault, and its message could carry
  // internals, so it stays in the log.
  if (err?.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  if (err?.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
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

try {
  await ensureSchema();
} catch (err) {
  console.error('Failed to connect to the database. Check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME in server/.env');
  console.error(err);
  process.exit(1);
}

// Receipt folders are derived from the user id on every read, so this has to
// finish relocating them before the first request arrives — hence awaited
// here rather than run as a background job.
try {
  await migrateReceiptFolders(pool, path.join(__dirname, '..', 'uploads'));
} catch (err) {
  console.error('Failed to migrate receipt folders — receipts may not be found until this succeeds');
  console.error(err);
}

// Expenses are repointed at the right year's category here, so this must
// finish before anything reads them.
try {
  await migrateCategoriesByYear(pool);
} catch (err) {
  console.error('Failed to split categories by financial year');
  console.error(err);
}

// Totals read the converted column, so every existing row needs one before
// anything sums them.
try {
  await migrateCurrencyBase(pool);
} catch (err) {
  console.error('Failed to backfill expense currency conversion');
  console.error(err);
}

try {
  await migrateAccountantInvites(pool);
} catch (err) {
  console.error('Failed to move accountant invitations');
  console.error(err);
}

// Every row has to belong to a set of books before anything is scoped to one.
// Awaited before the first request for the same reason the others are: entity
// is derived on every read, and half an answer is worse than a slow start.
try {
  await migrateEntities(pool);
} catch (err) {
  console.error('Failed to place records into entities');
  console.error(err);
}

purgeExpiredTrash(pool).catch((err) => console.error('Failed to purge deleted expenses', err));
setInterval(() => {
  purgeExpiredTrash(pool).catch((err) => console.error('Failed to purge deleted expenses', err));
}, 60 * 60 * 1000);

purgeUnactivatedAccounts(pool).catch((err) => console.error('Failed to purge unactivated accounts', err));
setInterval(() => {
  purgeUnactivatedAccounts(pool).catch((err) => console.error('Failed to purge unactivated accounts', err));
}, 60 * 60 * 1000);

runBillingReminders(pool).catch((err) => console.error('Failed to run billing reminders', err));
setInterval(() => {
  runBillingReminders(pool).catch((err) => console.error('Failed to run billing reminders', err));
}, 6 * 60 * 60 * 1000);

runRecurringExpenses(pool).catch((err) => console.error('Failed to run recurring expenses', err));
setInterval(() => {
  runRecurringExpenses(pool).catch((err) => console.error('Failed to run recurring expenses', err));
}, 60 * 60 * 1000);

// Accountant access is meant to be gone once its window closes. Requests
// already refuse an expired assignment, but "removed" should be true of the
// database whether or not anyone happens to sign in and trigger it — and both
// people should be told rather than finding out from an empty list.
const closeAccountantAccess = () =>
  closeExpiredAssignments(notify).catch((err) => console.error('Failed to close expired accountant access', err));
closeAccountantAccess();
setInterval(closeAccountantAccess, 15 * 60 * 1000);

// An invitation to read somebody's complete financial records should not sit
// live in a mailbox indefinitely. Twenty-four hours, then it is deleted and the
// client is told — so they hear it from us rather than by noticing the row has
// gone, and resending is one click.
const closeLapsedInvites = () =>
  closeExpiredInvites((invite) =>
    sendAccountantInviteLapsedEmail(invite.owner_email, invite.owner_name, invite.email, invite.name)
  ).catch((err) => console.error('Failed to close lapsed accountant invitations', err));
closeLapsedInvites();
setInterval(closeLapsedInvites, 15 * 60 * 1000);

// Twice a day is enough for something measured in months, and keeps the
// appointment reminder from slipping past its window if a restart lands badly.
runTaxReminders(pool).catch((err) => console.error('Failed to run tax reminders', err));
setInterval(() => {
  runTaxReminders(pool).catch((err) => console.error('Failed to run tax reminders', err));
}, 12 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Taxify server listening on http://localhost:${PORT}`);
});
