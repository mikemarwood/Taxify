// What a visit was, worked out from the little a browser volunteers.
//
// Everything here is pure so it can be tested without a request, a database or
// a clock. The parts that touch those live in analytics.routes.js.
//
// The shape of the problem: a page view arrives with a path, a referrer, a
// user agent and an IP. None of that is reliable and some of it is a lie, so
// each function here says what it does not know rather than guessing. A
// dashboard that invents a country is worse than one that says Unknown.

// Hosts that are us. A referrer from one of these is somebody moving around
// inside the product, not a click that brought them in — counting those as
// traffic sources makes the site its own biggest referrer and buries the ones
// that matter.
export const OWN_HOSTS = ['taxify.mikesapphub.com', 'mikesapphub.com', 'localhost'];

// Where a click came from, in the terms somebody deciding where to spend money
// would use. Not an exhaustive list of the web — the point is to separate the
// handful of sources worth acting on from everything else.
const SOURCES = [
  { kind: 'search', name: 'Google', match: /(^|\.)google\./i },
  { kind: 'search', name: 'Bing', match: /(^|\.)bing\.com$/i },
  { kind: 'search', name: 'DuckDuckGo', match: /(^|\.)duckduckgo\.com$/i },
  { kind: 'search', name: 'Yahoo', match: /(^|\.)search\.yahoo\./i },
  { kind: 'search', name: 'Ecosia', match: /(^|\.)ecosia\.org$/i },
  { kind: 'social', name: 'Facebook', match: /(^|\.)(facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com)$/i },
  { kind: 'social', name: 'Instagram', match: /(^|\.)instagram\.com$/i },
  { kind: 'social', name: 'Messenger', match: /(^|\.)messenger\.com$/i },
  { kind: 'social', name: 'LinkedIn', match: /(^|\.)linkedin\.com$/i },
  { kind: 'social', name: 'X', match: /(^|\.)(twitter\.com|x\.com|t\.co)$/i },
  { kind: 'social', name: 'Reddit', match: /(^|\.)reddit\.com$/i },
  { kind: 'social', name: 'YouTube', match: /(^|\.)youtube\.com$/i },
  { kind: 'social', name: 'TikTok', match: /(^|\.)tiktok\.com$/i },
  { kind: 'social', name: 'WhatsApp', match: /(^|\.)whatsapp\.com$/i },
  // Worth its own kind rather than filed under search. Somebody arriving from
  // an assistant asked a question and was recommended; that is a different
  // thing from a search result, and it is a channel that did not exist when
  // most analytics were designed.
  { kind: 'ai', name: 'ChatGPT', match: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i },
  { kind: 'ai', name: 'Claude', match: /(^|\.)claude\.ai$/i },
  { kind: 'ai', name: 'Perplexity', match: /(^|\.)perplexity\.ai$/i },
  { kind: 'ai', name: 'Gemini', match: /(^|\.)gemini\.google\.com$/i },
  { kind: 'email', name: 'Gmail', match: /(^|\.)mail\.google\.com$/i },
  { kind: 'email', name: 'Outlook', match: /(^|\.)outlook\./i },
];

// The host part of a referrer, or null when there isn't one worth reading.
export function referrerHost(referrer) {
  const raw = String(referrer || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Web pages only. "android-app://com.example" parses perfectly well and
    // yields a hostname, so leaving this out files an app's own internal
    // navigation under a referring website that does not exist.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    // Not a URL at all. Browsers send junk here more often than you would
    // think, and none of it is a host.
    return null;
  }
}

// { kind, name } — kind drives the grouping, name is what goes on the chart.
//
// `direct` covers more than people typing the address: a link in a native app,
// a PDF, a QR code and most https-to-http hops all arrive with no referrer at
// all. It is the honest label for "we were not told", which is why it is not
// called "typed in".
export function classifyReferrer(referrer, ownHosts = OWN_HOSTS) {
  const host = referrerHost(referrer);
  if (!host) return { kind: 'direct', name: 'Direct' };
  if (ownHosts.some((own) => host === own || host.endsWith('.' + own))) {
    return { kind: 'internal', name: host };
  }
  const known = SOURCES.find((s) => s.match.test(host));
  if (known) return { kind: known.kind, name: known.name };
  return { kind: 'other', name: host };
}

// Campaign tags, when a link carries them.
//
// utm_* is the convention every ad platform writes, so a Facebook ad built
// with them is attributable even when the referrer is stripped — which it
// often is, because clicks route through l.facebook.com and app browsers.
export function campaignFrom(url) {
  const empty = { source: null, medium: null, campaign: null };
  const raw = String(url || '');
  if (!raw.includes('utm_') && !raw.includes('fbclid') && !raw.includes('gclid')) return empty;
  let params;
  try {
    params = new URL(raw, 'https://taxify.mikesapphub.com').searchParams;
  } catch {
    return empty;
  }
  const tidy = (v) => {
    const s = String(v || '').trim().slice(0, 60);
    return s || null;
  };
  const source = tidy(params.get('utm_source'));
  // A click id with no utm_source is still a paid click and should not be
  // filed as unattributed — the platform is in the parameter's name.
  const implied = params.get('fbclid') ? 'facebook' : params.get('gclid') ? 'google' : null;
  return {
    source: source || implied,
    medium: tidy(params.get('utm_medium')) || (implied ? 'cpc' : null),
    campaign: tidy(params.get('utm_campaign')),
  };
}

// Crawlers, previewers and monitors.
//
// These are most of the hits on a small site and none of them are people. Left
// in, they make every chart a picture of robot activity — and the day a
// Facebook share is posted, the preview fetches look exactly like a spike of
// interest.
const BOTS =
  /bot|crawler|spider|crawl|slurp|facebookexternalhit|facebookcatalog|whatsapp|telegram|discord|slackbot|embedly|quora link preview|pinterest|bitlybot|vkshare|preview|monitor|uptime|pingdom|lighthouse|headlesschrome|curl\/|wget\/|python-requests|axios\/|node-fetch|go-http-client|java\/|okhttp|postman|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|ccbot|claudebot|perplexitybot|applebot|duckduckbot|yandex|baidu/i;

export function isBot(userAgent) {
  return BOTS.test(String(userAgent || ''));
}

// The path, trimmed to something a report can group by.
//
// Ids are replaced with a marker so a hundred visits to a hundred tickets read
// as one busy page rather than a hundred pages nobody visited twice, and the
// query string goes entirely: it holds campaign tags, which are read
// separately, and occasionally holds things that should never be stored.
export function normalisePath(path) {
  let raw = String(path || '/').trim();
  const q = raw.search(/[?#]/);
  if (q !== -1) raw = raw.slice(0, q);
  if (!raw.startsWith('/')) raw = '/' + raw;
  raw = raw.replace(/\/{2,}/g, '/');
  if (raw.length > 1) raw = raw.replace(/\/+$/, '');
  const parts = raw.split('/').map((seg) => {
    if (/^\d+$/.test(seg)) return ':id';
    // Tokens and references: long, and one per record.
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
    if (/^[A-Z]{2,4}-?\d{3,}$/.test(seg)) return ':ref';
    return seg;
  });
  return parts.join('/').slice(0, 160) || '/';
}

// An ISO country code, or null. Never a default.
//
// detectCountry in auth.routes falls back to Australia, which is right for a
// sign-up form's dropdown and wrong here: a chart that files every unknown
// visitor under one country is not reporting, it is deciding. Whether these
// headers arrive at all depends on what sits in front of the server, so the
// honest answer is often none.
export function countryFrom(headers = {}) {
  const raw =
    headers['cf-ipcountry'] ||
    headers['x-vercel-ip-country'] ||
    headers['x-geo-country'] ||
    headers['x-country-code'] ||
    null;
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  // Cloudflare uses XX for "could not tell" and T1 for Tor.
  if (code === 'XX' || code === 'T1') return null;
  return code;
}

// A country from the browser's own regional setting, as a last resort.
//
// Why this exists: the network-level country is a header the thing in front of
// the server has to add, and nginx without a GeoIP module adds nothing — so on
// a plain setup every single visit files as Unknown, which is true and useless.
//
// Accept-Language carries a region subtag on most browsers: "en-AU" is
// somebody whose machine is set to Australian English. That is a weaker claim
// than an IP lookup — a British expat in Sydney may still send en-GB — so it
// is recorded with its source rather than passed off as the same thing.
//
// Only the region half is read. A bare "en" says nothing about where anybody
// is and must not be turned into a country.
export function countryFromLocale(acceptLanguage) {
  const raw = String(acceptLanguage || '').trim();
  if (!raw) return null;
  for (const part of raw.split(',')) {
    const tag = part.split(';')[0].trim();
    const match = /^[A-Za-z]{2,3}-(?:[A-Za-z]{4}-)?([A-Za-z]{2})$/.exec(tag);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

// A run of days with no gaps, so a chart has the same number of columns every
// time it is drawn. A missing day is a zero, not an absence — a line that
// skips Sunday is a line that lies about Monday.
export function fillDays(rows, days, { key = 'day', value = 'n' } = {}) {
  const byDay = new Map();
  for (const r of rows || []) {
    byDay.set(String(r[key]).slice(0, 10), Number(r[value]) || 0);
  }
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ day: iso, value: byDay.get(iso) || 0 });
  }
  return out;
}

// Which way a number has moved, as a percentage, or null when there is nothing
// to compare against.
//
// Zero to anything is not "infinity per cent" and should not be drawn as a
// number at all — the honest report there is "new", which is what null lets
// the caller say.
export function changeBetween(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}
