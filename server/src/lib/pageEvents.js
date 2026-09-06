import crypto from 'crypto';
import pool from '../db.js';
import { describeUserAgent } from './deviceInfo.js';
import { campaignFrom, classifyReferrer, countryFrom, countryFromLocale, isBot, normalisePath } from './analytics.js';
import { countryByName } from './geoData.js';

// Writing one row to page_events, from wherever the event happened.
//
// Pulled out of the analytics routes because three different places need it
// now and only one of them is an analytics route: the beacon the app posts,
// the pixel the landing page loads, the redirect that counts a press, and the
// sign-up route itself. A funnel is only worth reading if every step is
// recorded the same way.

export const VISITOR_COOKIE = 'txv';
const VISITOR_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// Who this is, as far as we are concerned: a random id in a cookie of ours,
// and nothing that could identify a person.
//
// Lax rather than None. The landing page and the app are the same host, so
// this is first-party on both and a visitor can be followed from arriving to
// signing up — which is the whole basis of the funnel. Read through the hub's
// own address it is third-party and browsers drop it; those visits are counted
// but cannot be joined up, and the panel says so.
export function visitorFrom(req, res) {
  const existing = String(req.cookies?.[VISITOR_COOKIE] || '');
  if (/^[0-9a-f]{32}$/.test(existing)) return { visitor: existing, isNew: false };

  const visitor = crypto.randomBytes(16).toString('hex');
  res?.cookie?.(VISITOR_COOKIE, visitor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: VISITOR_MAX_AGE_MS,
    path: '/',
  });
  return { visitor, isNew: true };
}

// Where this visit came from, and how confidently we know. See analytics.js —
// the source is stored alongside the country so a browser's language setting
// is never reported as a measurement.
export function countryOf(req) {
  const header = countryFrom(req.headers);
  if (header) return { code: header, source: 'header' };

  const account = req.user?.country ? countryByName(req.user.country) : null;
  if (account) return { code: account.code, source: 'account' };

  const locale = countryFromLocale(req.headers['accept-language']);
  if (locale) return { code: locale, source: 'locale' };

  return { code: null, source: null };
}

// Returns { ok } or { skipped }. Never throws: measuring something must not be
// able to break the thing being measured, and every caller here is on a path
// that matters more than the row.
export async function recordPageEvent(req, res, body = {}) {
  try {
    const userAgent = req.headers['user-agent'];
    // Silently ignored rather than refused. A crawler that gets a 400 tries
    // again; one that gets its answer goes away.
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
        body.userId ?? req.user?.id ?? null,
      ]
    );
    return { ok: true };
  } catch (err) {
    console.error('Could not record a page event', err.message);
    return { skipped: 'error' };
  }
}
