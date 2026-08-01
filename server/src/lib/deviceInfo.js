import pool from '../db.js';

// A user agent read the way a person would describe it: "iPad, Safari", not
// 200 characters of version soup. Deliberately shallow — this exists to answer
// "what were they using", not to fingerprint anybody.

// The Android build is a Capacitor WebView pointed at the live site, so it
// looks like Chrome on Android unless it says otherwise. `TaxifyAndroid` is
// appended by capacitor.config.json; the rest catch a WebView that predates
// that setting — `; wv)` and the stranded `Version/4.0` are both signatures
// Android WebView carries and Chrome proper does not.
const APP_MARKERS = [/taxify/i, /capacitor/i, /;\s*wv\)/i, /Version\/4\.0.*Chrome/i];

export function describeUserAgent(raw) {
  const ua = String(raw || '');
  if (!ua) return { device: 'unknown', platform: null, browser: null };

  const isApp = APP_MARKERS.some((re) => re.test(ua));

  let platform = null;
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) platform = 'iPadOS';
  else if (/iPhone|iPod/i.test(ua)) platform = 'iOS';
  else if (/Android/i.test(ua)) platform = 'Android';
  else if (/Windows NT/i.test(ua)) platform = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) platform = 'macOS';
  else if (/CrOS/i.test(ua)) platform = 'ChromeOS';
  else if (/Linux/i.test(ua)) platform = 'Linux';

  let device = 'desktop';
  if (platform === 'iPadOS' || /Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = 'tablet';
  else if (platform === 'iOS' || platform === 'Android' || /Mobile/i.test(ua)) device = 'mobile';

  // Order matters: Edge and Opera both claim Chrome, Chrome claims Safari.
  let browser = null;
  if (isApp) browser = 'Taxify app';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  if (isApp && platform === 'Android') device = 'android-app';

  return { device, platform, browser };
}

// The address the request actually came from. In production nginx sits in
// front, so the socket address is always 127.0.0.1 — the forwarded header is
// the only useful value, and only the first entry is ours to trust.
export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 45);
  }
  return (req.ip || req.socket?.remoteAddress || '').slice(0, 45);
}

// Never allowed to break a login: someone getting in matters, recording that
// they did is bookkeeping.
export async function recordLogin(req, userId, method) {
  try {
    const { device, platform, browser } = describeUserAgent(req.headers['user-agent']);
    await pool.execute(
      'INSERT INTO login_events (user_id, device, platform, browser, ip, method) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, device, platform, browser, clientIp(req), method]
    );
  } catch (err) {
    console.error('Failed to record login event', err.message);
  }
}
