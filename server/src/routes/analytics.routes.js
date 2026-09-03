import { Router } from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { optionalAuth } from '../auth/middleware.js';
import { describeUserAgent } from '../lib/deviceInfo.js';
import {
  campaignFrom,
  classifyReferrer,
  countryFrom,
  countryFromLocale,
  isBot,
  normalisePath,
} from '../lib/analytics.js';
import { countryByName } from '../lib/geoData.js';

const router = Router();

// Recording what happened, from two directions.
//
// The app posts. It is our own origin, scripts run, and a fetch can carry a
// body with the path and whatever the click was.
//
// The landing page cannot always post. Read through the hub it is proxied, and
// the proxy strips every <script> from the page — so on that copy there is no
// JavaScript at all, and its Content-Security-Policy allows connections only
// to the hub itself, which would block a fetch here even if one could be made.
// What the proxy does leave alone, and does rewrite to an absolute URL, is an
// <img>. So the second way in is a one-pixel image: no script, no fetch, and
// it works on both copies of the page.
//
// That is why this file has two endpoints doing one job.

const VISITOR_COOKIE = 'txv';
const VISITOR_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// A 1x1 transparent GIF, the smallest thing a browser will accept as an image.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Who this is, as far as we are concerned: a random id in a cookie of ours,
// and nothing that could identify a person.
//
// Set here rather than anywhere else because this is the first request a
// visitor makes that we control. Lax rather than None: the cookie is for our
// own pages, and SameSite=None would need Secure plus a third-party cookie
// that most browsers now refuse anyway.
function visitorFrom(req, res) {
  const existing = String(req.cookies?.[VISITOR_COOKIE] || '');
  if (/^[0-9a-f]{32}$/.test(existing)) return { visitor: existing, isNew: false };

  const visitor = crypto.randomBytes(16).toString('hex');
  res.cookie(VISITOR_COOKIE, visitor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: VISITOR_MAX_AGE_MS,
    path: '/',
  });
  return { visitor, isNew: true };
}

// Everything a row needs, from the request and the little the caller sends.
//
// The caller is a browser and is not trusted with any of it: the path is
// normalised, the label is capped, and the surface is one of two words or the
// row is refused. Nothing here is ever rendered as HTML, but a table that
// takes whatever it is handed is a table that eventually holds something it
// should not.
// Where this visit came from, and how confidently we know.
//
// Three sources, best first, and the answer carries which one it was — because
// they are not the same claim and a chart that mixes them silently is one that
// gets quoted as fact.
//
//   header  a country the network worked out from the IP. The real answer, and
//           the one that needs nothing from the visitor — but it only exists
//           if whatever sits in front of this server adds it. Plain nginx does
//           not, which is why everything read Unknown.
//
//   account the country on the signed-in account. Exact, because they typed
//           it, and only available once somebody has signed in.
//
//   locale  the region in the browser's language setting. A guess: en-AU is
//           usually somebody in Australia and sometimes an Australian abroad.
//           Better than nothing and clearly labelled as the weakest of the
//           three.
function countryOf(req) {
  const header = countryFrom(req.headers);
  if (header) return { code: header, source: 'header' };

  const account = req.user?.country ? countryByName(req.user.country) : null;
  if (account) return { code: account.code, source: 'account' };

  const locale = countryFromLocale(req.headers['accept-language']);
  if (locale) return { code: locale, source: 'locale' };

  return { code: null, source: null };
}

async function record(req, res, body) {
  const userAgent = req.headers['user-agent'];
  // Silently ignored rather than refused. A crawler that gets a 400 tries
  // again; one that gets a pixel goes away.
  if (isBot(userAgent)) return { skipped: 'bot' };

  const surface = body.surface === 'landing' ? 'landing' : body.surface === 'app' ? 'app' : null;
  if (!surface) return { skipped: 'surface' };

  const event = String(body.event || 'view').trim().slice(0, 40) || 'view';
  const { visitor, isNew } = visitorFrom(req, res);
  const referrer = classifyReferrer(body.referrer || req.headers.referer || '');
  const utm = campaignFrom(body.url || '');
  const ua = describeUserAgent(userAgent);
  const where = countryOf(req);

  await pool.execute(
    `INSERT INTO page_events
       (surface, event, path, label, visitor, is_new, referrer_kind, referrer_name,
        utm_source, utm_medium, utm_campaign, country, country_source, device, platform, browser, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      surface,
      event,
      normalisePath(body.path),
      body.label ? String(body.label).trim().slice(0, 80) : null,
      visitor,
      isNew ? 1 : 0,
      referrer.kind,
      referrer.name.slice(0, 120),
      utm.source,
      utm.medium,
      utm.campaign,
      where.code,
      where.source,
      ua.device,
      ua.platform,
      ua.browser,
      req.user?.id || null,
    ]
  );
  return { ok: true };
}

// The app's way in. optionalAuth so a signed-in view can be told from an
// anonymous one without ever requiring a session — the sign-in page itself is
// the most important thing on here to measure.
router.post(
  '/event',
  optionalAuth,
  asyncHandler(async (req, res) => {
    try {
      await record(req, res, req.body || {});
    } catch (err) {
      // Never let measuring something break the thing being measured.
      console.error('Could not record a page event', err.message);
    }
    res.status(204).end();
  })
);

// The landing page's way in, and the only one that survives the hub's proxy.
//
// Answers with the pixel whatever happens, including when the write fails: a
// broken image on a marketing page is a visible fault caused by an invisible
// feature, which is the wrong way round.
router.get(
  '/px.gif',
  // Same as the beacon: a signed-in visitor reading the landing page can have
  // their own country used rather than being guessed at from a locale.
  optionalAuth,
  asyncHandler(async (req, res) => {
    try {
      await record(req, res, {
        surface: String(req.query.s || 'landing'),
        event: String(req.query.e || 'view'),
        path: String(req.query.p || '/'),
        label: req.query.l ? String(req.query.l) : null,
        referrer: String(req.query.r || req.headers.referer || ''),
        url: String(req.query.u || ''),
      });
    } catch (err) {
      console.error('Could not record a pixel event', err.message);
    }
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Content-Length', String(PIXEL.length));
    res.end(PIXEL);
  })
);

export default router;
