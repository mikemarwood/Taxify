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
import adminSupportRoutes from './routes/adminSupport.routes.js';
import appRoutes from './routes/app.routes.js';
import billingRoutes from './routes/billing.routes.js';
import supportRoutes from './routes/support.routes.js';
import exportRoutes from './routes/export.routes.js';
import taxYearRoutes from './routes/taxYears.routes.js';
import deductionRoutes from './routes/deductions.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import entityRoutes from './routes/entities.routes.js';
import { AD_SLOTS, adFile, posterFile, adsPresent, faststartExistingAds } from './lib/landingAds.js';
import { cutEmptyAdSlots } from './lib/landingAdsHtml.js';
import { injectLandingSocial } from './lib/landingSocial.js';
import { landingSocialConfig } from './lib/socialSettings.js';
import { injectAppDownload, isAndroidAgent } from './lib/landingAppDownload.js';
import { injectLandingReviews } from './lib/landingReviews.js';
import { publicOrigin } from './lib/publicOrigin.js';
import { sweepExpiredInvites } from './lib/accountantInviteFlow.js';
import { purgeUnactivatedAccounts, runBillingReminders } from './jobs/billingJobs.js';
import { runRecurringExpenses } from './jobs/expenseJobs.js';
import { runTaxReminders } from './jobs/taxReminders.js';
import pool, { ensureSchema } from './db.js';
import { migrateReceiptFolders } from './migrations/receiptFolders.js';
import { migrateCategoriesByYear } from './migrations/categoriesByYear.js';
import { migrateCurrencyBase } from './migrations/currencyBase.js';
import { migrateEntities } from './migrations/entities.js';
import { migrateAccountantInvites } from './migrations/accountantInvites.js';
import { migrateCategoryEntities } from './migrations/categoryEntities.js';
import { migrateCategoriesEveryBook } from './migrations/categoriesEveryBook.js';
import { migrateDefaultCategoryKinds } from './migrations/defaultCategoryKinds.js';
import { migrateAccountantFlag } from './migrations/accountantFlag.js';
import { migrateSplitBothCategories } from './migrations/splitBothCategories.js';
import { migrateRemoveSecondLogins } from './migrations/removeSecondLogins.js';
import { migrateAccountNumbers } from './migrations/accountNumbers.js';
import { closeExpiredAssignments } from './auth/accountants.js';
import { closeExpiredInvites } from './auth/accountantInvites.js';
import { notify } from './lib/notify.js';
import assetLinksRoutes from './routes/assetLinks.routes.js';
import { maintenanceGate, maintenanceStatus } from './middleware/maintenanceGate.js';
import { sendAccountantInviteLapsedEmail } from './lib/mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// One hop, because there is exactly one: the reverse proxy in front of this.
//
// Without it req.protocol is always http — the proxy terminates TLS and talks
// to us in the clear — so anything built from it hands out an http:// URL for
// an https:// site. That is what broke the Android updater: Download Manager
// refuses cleartext on Android 9 and later, so every update failed with
// 'Download unsuccessful' and nothing said why.
//
// A number rather than true: trusting every hop lets a client forge
// X-Forwarded-For and with it whatever reads req.ip.
app.set('trust proxy', 1);
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

// The advertisement slots, cut out of the page when they are empty.
//
// The landing page has no JavaScript it can depend on: the hub proxy strips
// scripts, so a slot cannot hide itself. A <video> whose file is missing is a
// black box with a dead control bar, which is worse than no section at all —
// so the decision is made here, on the way out, where the disk can be checked.
//
// Comments survive the proxy, which is what makes them usable as cut marks.
// Verified against the live hub copy rather than assumed.
function withLandingAds(html) {
  return cutEmptyAdSlots(
    html,
    adsPresent(),
    AD_SLOTS.filter((slot) => posterFile(slot) !== null),
    publicOrigin()
  );
}

// The Facebook buttons, for the same reason and by the same mechanism: the
// page cannot read a setting for itself, so it is done here on the way out.
// Every path that serves the page goes through this, including the fallbacks —
// otherwise the buttons would appear only when the hub was reachable.
// The APK, if a build has produced one.
//
// Stat'd per request rather than remembered at startup: a deploy replaces this
// file, and a page that went on advertising the previous size — or went on
// advertising nothing because the first build happened after the server came
// up — would be wrong in a way nobody would think to check. One stat is
// cheaper than being wrong.
const APK_PATH = path.join(__dirname, '..', '..', 'client', 'dist', 'downloads', 'taxify.apk');

function apkOffer(req) {
  let sizeBytes;
  try {
    sizeBytes = fs.statSync(APK_PATH).size;
  } catch {
    return { available: false };
  }
  return {
    available: true,
    sizeBytes,
    isAndroid: isAndroidAgent(req.headers['user-agent']),
    origin: publicOrigin(),
  };
}

async function withLandingExtras(html, req) {
  return injectLandingReviews(
    injectAppDownload(
      injectLandingSocial(withLandingAds(html), await landingSocialConfig()),
      apkOffer(req)
    )
  );
}

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
  if (!isBrowserNavigation) {
    // Read and sent rather than sendFile, so the same slot-cutting applies
    // to the static copy. The hub's scraper takes this path, so an empty
    // slot never reaches the hub to be cached in the first place.
    try {
      const file = await fs.promises.readFile(LANDING_HTML_PATH, 'utf8');
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Vary', 'User-Agent');
      return res.send(await withLandingExtras(file, req));
    } catch {
      return res.sendFile(LANDING_HTML_PATH);
    }
  }

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
      res.set('Vary', 'User-Agent');
    res.send(await withLandingExtras(html, req));
  } catch (err) {
    console.error('[landing] hub proxy failed, falling back to static page:', err.message);
    try {
      const file = await fs.promises.readFile(LANDING_HTML_PATH, 'utf8');
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Vary', 'User-Agent');
      res.send(await withLandingExtras(file, req));
    } catch {
      res.sendFile(LANDING_HTML_PATH);
    }
  }
}

// The address people are given, link to and search for.
//
// It used to be the app, so a signed-out visitor arriving from an ad or a
// search result was shown a login form for a product nobody had explained to
// them yet — while the page written to do the explaining sat at /landing, a URL
// nobody would ever type.
//
// Shown to everybody, signed in or not. That is what keeps it cacheable: no
// session is read here, so it is the same bytes for every visitor.
// The advertisement files themselves.
//
// Public and unauthenticated, because the page they are on is. No extension in
// the URL: the slot is the name, and what is on disk decides the type — so
// replacing an mp4 with a webm changes nothing about the page.
//
// Range requests are what let somebody scrub a video without downloading all
// of it, and res.sendFile handles them. immutable is deliberately not set:
// these are replaced in place and a week-long cache would show the old film.
// One route for both, because two would shadow each other: a route for
// /media/ads/:slot matches ad-1-poster as readily as ad-1, and whichever was
// registered first would answer for both. The suffix decides which it is.
app.get('/media/ads/:name', (req, res) => {
  const name = String(req.params.name || '');
  const wantsPoster = name.endsWith('-poster');
  const slot = wantsPoster ? name.slice(0, -'-poster'.length) : name;
  const found = wantsPoster ? posterFile(slot) : adFile(slot);
  if (!found) return res.status(404).end();
  res.type(found.type);
  // Five minutes, not a year. These are replaced in place, and a long cache
  // would go on showing last month's advertisement to everybody who had
  // already seen it.
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(found.file);
});

app.get('/', serveLandingPage);

// Crawl directives for this host.
//
// It answered with the landing page — 200, text/html — because the catch-all
// takes anything it does not recognise. A robots.txt that is HTML is a
// robots.txt that parses to nothing, so this host had no directives at all.
//
// Crawling is allowed rather than refused, deliberately. The canonical on the
// landing page points at the hub, and that is the signal that settles which of
// the two addresses ranks — but a crawler has to be allowed to fetch the page
// to read the canonical in the first place. Blocking it here would leave the
// duplicate un-deduplicated rather than gone, and would stop Facebook reading
// the Open Graph tags it scrapes from this host.
//
// The sitemap named is the hub's, for the same reason: the hub's addresses are
// the ones worth listing.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      // Behind a login, so crawling it only spends budget on sign-in forms.
      'Disallow: /app',
      'Disallow: /api/',
      // Somebody else's advertisement and a binary; neither is a search result.
      'Disallow: /media/ads/',
      'Disallow: /downloads/',
      '',
      'Sitemap: https://mikesapphub.com/sitemap.xml',
      '',
    ].join('\n')
  );
});

// No sitemap of our own, and a 404 rather than the landing page.
//
// A sitemap here would list this host's addresses, which is precisely what the
// canonical spends its time telling search engines not to index. Saying
// plainly that there is not one is better than answering with a page of HTML
// that claims to be XML.
app.get('/sitemap.xml', (req, res) => {
  res.status(404).type('text/plain').send('No sitemap here. See https://mikesapphub.com/sitemap.xml\n');
});

// The old address for it, kept working.
app.get('/landing', (req, res) => res.redirect(301, '/'));

// Where the app used to live.
//
// Every one of these is sitting in somebody's inbox right now — an activation
// link, a password reset, an accountant invitation, a support ticket. A
// permanent redirect is the difference between those working and those being a
// blank page a fortnight after we moved the furniture.
//
// An explicit list rather than a wildcard, so there is no path that can bounce
// back and forth: /app is not in it, and nothing here collides with a static
// file. The query string carries over, because for half of these the token is
// the link.
const MOVED_TO_APP = [
  // Taken from the route table in client/src/App.jsx rather than guessed —
  // a path invented here is a link in somebody's inbox that quietly 404s.
  'accept-invite', 'account', 'activate', 'add', 'admin', 'books', 'categories',
  'clients', 'confirm-email', 'deductions', 'expenses', 'forgot-password', 'login',
  'privacy', 'register', 'reports', 'reset-password', 'support', 'terms',
];

app.get(new RegExp('^/(' + MOVED_TO_APP.join('|') + ')(/.*)?$'), (req, res) => {
  const mark = req.originalUrl.indexOf('?');
  const query = mark === -1 ? '' : req.originalUrl.slice(mark);
  res.redirect(301, '/app' + req.path + query);
});

// Before everything else that answers a GET. Android fetches this over plain
// HTTPS with no session, and the catch-all at the bottom would hand it
// index.html with a 200 — which reads as a malformed asset-links file and
// silently turns app links back into browser links.
app.use(assetLinksRoutes);

// Whether the site is deliberately offline, and what to say about it. Outside
// the gate, because the sign-in page asks it in order to explain itself.
app.get('/api/maintenance', maintenanceStatus);

// The same Facebook settings the landing page is built from, for the sign-in
// panel to draw its own buttons from.
//
// The same settings deliberately, not a second copy: switching Facebook off in
// admin has to switch it off in both places, and the address shared has to be
// the same address, or the two would advertise different pages under one name.
// What gets shared is the landing URL, so its Open Graph tags supply the title,
// description and picture — which is what "shares the same content" means here.
//
// Public and unauthenticated, because the people looking at the sign-in page
// are by definition not signed in yet.
app.get('/api/social', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await landingSocialConfig());
  } catch {
    // A settings table that cannot be read is not a reason to fail the page
    // this sits on. Off is the safe answer: the panel renders without it.
    res.json({ enabled: false });
  }
});

// Measurement sits in front of the gate, deliberately.
//
// Everything else here is a feature and should stop when the site is switched
// off. This writes one row and answers with an image, and the landing page
// stays up during an outage — putting it behind the gate would mean the
// marketing page grows a broken image icon exactly when somebody has taken the
// app down to fix something.
app.use('/api/analytics', analyticsRoutes);

// The gate, in front of every API router rather than inside them. A route that
// forgot to opt in would be a hole in the middle of an outage, and the list of
// routes only ever grows. Admins pass; see lib/maintenance.js for the short
// list of paths that keep working so an admin can still sign in.
app.use('/api', maintenanceGate);

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/expenses', expensesRoutes);
// Mounted before the admin router so its own, looser guard is reached first.
// Both live under /api/admin; the paths do not overlap.
app.use('/api/admin', adminSupportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/app', appRoutes);
app.use('/api/billing', billingRoutes);
// Deliberately not behind requireAuth: somebody who cannot sign in is exactly
// who most needs to reach support. The routes that need an account ask for one
// themselves.
app.use('/api/support', supportRoutes);
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
  // Which request failed, not only how. A bare stack in pm2's log gives no way
  // to tell which button somebody pressed, and "Something went wrong" is all
  // the person who pressed it ever sees — so this line is the only record of
  // what actually happened. A MariaDB error carries its own code and the
  // offending column, both worth having.
  console.error(
    `[500] ${req.method} ${req.originalUrl}` +
      (req.user?.id ? ` user=${req.user.id}` : '') +
      (err?.code ? ` code=${err.code}` : ''),
    err
  );
  res.status(500).json({ error: 'Something went wrong' });
});

if (isProd) {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    // Vite writes a content hash into every filename in /assets, so those can
    // be cached forever — the name changes when the content does.
    // Vite writes /app/assets/… into index.html now, so this is where the
    // hashed bundle has to answer from.
    app.use(
      '/app/assets',
      express.static(path.join(clientDist, 'assets'), {
        immutable: true,
        maxAge: '1y',
        // A miss here must be a miss. Without this the catch-all below answers
        // with index.html and a 200, so the browser is handed HTML where it
        // asked for JavaScript, fails to parse it, and renders nothing at all —
        // a blank page with no error anywhere. Anything under /assets that is
        // not on disk is a genuine 404.
        fallthrough: false,
      })
    );

    app.use('/downloads', express.static(path.join(clientDist, 'downloads'), {
      setHeaders: (res) => res.set('Cache-Control', 'no-store'),
    }));

    // Everything else in the build, still answering at the root.
    //
    // The landing page asks for /media/… and /logo.svg absolutely, Android
    // fetches /downloads/taxify.apk, and browsers look for /favicon.ico and
    // /site.webmanifest wherever they please. None of that belongs to the app,
    // so none of it moves.
    app.use(express.static(clientDist, {
      // index.html is the one file that must never be cached. It is the map to
      // every hashed asset, so a stale copy points at chunks that were deleted
      // by the last deploy — which is how a working build still comes up empty
      // in somebody's browser.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.set('Cache-Control', 'no-store, must-revalidate');
      },
      // The app's own routes are handled below. Without this, a request for /
      // would be answered with the built index.html before the landing page
      // ever got a look at it.
      index: false,
    }));

    // The same files again, under /app.
    //
    // Vite rewrites everything index.html references — including the favicons
    // and the manifest, which live in public/ — to sit under the base path. So
    // the built page asks for /app/favicon.svg while landing.html asks for
    // /favicon.svg, and both are correct. Serving the build at both addresses
    // is cheaper than arguing with the bundler about which of the two is right.
    app.use('/app', express.static(clientDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.set('Cache-Control', 'no-store, must-revalidate');
      },
      index: false,
    }));

    // The app itself. Any depth under /app is a route the router will match, so
    // it gets index.html and React works out what it means.
    //
    // Narrowed from "anything that is not /api", which is what let the app own
    // the whole site.
    app.get(/^\/app(\/.*)?$/, (req, res) => {
      res.set('Cache-Control', 'no-store, must-revalidate');
      res.sendFile(path.join(clientDist, 'index.html'));
    });

    // Anything else. A mistyped URL is a visitor, not a dead end — they get the
    // page that explains what this is.
    //
    // With a 404 status on it, which is the part that was missing. A person
    // sees the same helpful page either way; a crawler is told the address is
    // not real. Answering 200 to every path meant one broken link pointing
    // here produced an unlimited supply of URLs that all returned the landing
    // page, and a search engine has no way to tell those from the real one.
    //
    // res.send keeps a status set beforehand, so this needs nothing from
    // serveLandingPage itself.
    app.get(/^(?!\/api).*/, (req, res) => {
      res.status(404);
      return serveLandingPage(req, res);
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

// Nothing depends on this having run — every account works off users.id
// either way — so it sits after the migrations that things do depend on.
try {
  await migrateAccountNumbers(pool);
} catch (err) {
  console.error('Failed to give existing accounts a public number');
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

// After the entities migration too: a converted second login needs a set of
// books of its own, and creating one means entities must already exist.
try {
  await migrateRemoveSecondLogins(pool);
} catch (err) {
  console.error('Failed to convert second logins into their own accounts');
  console.error(err);
}

// After the entities migration, not before — it places categories into their
// owner's default set of books, and that has to exist first.
try {
  await migrateCategoryEntities(pool);
  // After the one above, which is what puts a set of books on the stranded
  // rows — copying them across before that would copy rows with no book.
  await migrateCategoriesEveryBook(pool);
  await migrateDefaultCategoryKinds(pool);
  await migrateAccountantFlag(pool);
  // After the per-kind seed, which is what creates the rows this splits.
  await migrateSplitBothCategories(pool);
} catch (err) {
  console.error('Failed to place categories into their set of books');
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

// Invitations nobody answered.
//
// Every fifteen minutes rather than hourly, because the client is watching a
// countdown on their side and an invitation that reads "expired" for
// three-quarters of an hour before the email arrives is worse than not showing
// the countdown at all.
//
// The sweep asks what is already true rather than setting a timer per
// invitation, so a restart costs nothing — a timer would have to survive one,
// and this does not have to.
sweepExpiredInvites().catch((err) => console.error('Failed to sweep expired invitations', err));
setInterval(() => {
  sweepExpiredInvites().catch((err) => console.error('Failed to sweep expired invitations', err));
}, 15 * 60 * 1000);

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
  closeExpiredInvites(async (invite) => {
    await sendAccountantInviteLapsedEmail(invite.owner_email, invite.owner_name, invite.email, invite.name);
    // In the app as well as in an inbox. The email is the one that gets read
    // first, but the row has just disappeared from their account page and the
    // notification is what explains where it went.
    await notify(invite.owner_user_id, {
      title: 'Your accountant invitation expired',
      body: `${invite.name || invite.email} did not accept within 24 hours. Nobody was given access — send it again if you still want to.`,
      url: '/account',
      kind: 'accountant',
    });
  }).catch((err) => console.error('Failed to close lapsed accountant invitations', err));
closeLapsedInvites();
setInterval(closeLapsedInvites, 15 * 60 * 1000);

// Twice a day is enough for something measured in months, and keeps the
// appointment reminder from slipping past its window if a restart lands badly.
runTaxReminders(pool).catch((err) => console.error('Failed to run tax reminders', err));
setInterval(() => {
  runTaxReminders(pool).catch((err) => console.error('Failed to run tax reminders', err));
}, 12 * 60 * 60 * 1000);

// Advertisements uploaded before the index was moved on the way in.
//
// Those are the ones people are watching right now, and the symptom — a frame
// that stays blank on one network and plays on another — is not something the
// viewer can report usefully or the admin can see. Cheap: it reads each file
// once, and does nothing at all to one that is already in the right order.
faststartExistingAds();

app.listen(PORT, () => {
  console.log(`Taxify server listening on http://localhost:${PORT}`);
});
