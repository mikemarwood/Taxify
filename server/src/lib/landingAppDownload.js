// The Android download on the landing page, decided by the server.
//
// The page cannot decide this for itself. Working out whether somebody is on
// an Android phone means reading the user agent, and the hub proxy strips
// every script from this page before a visitor sees it — measured, not
// assumed: fetch the live page and our own functions are simply not in it.
// HTML comments do survive, which is what makes them usable as markers, the
// same way the advertisement slots and the Facebook buttons work.
//
// The link has to be absolute, and that is not belt and braces. The hub
// rewrites a relative `src` to taxify.mikesapphub.com but rewrites a relative
// `href` to its own domain — /app/terms is served to real visitors as
// https://mikesapphub.com/terms. A relative /downloads/taxify.apk would
// therefore point at a file on the hub that does not exist.

// Android, but not an iPad pretending, and not a desktop with "Android" in a
// developer string. Simple on purpose: the cost of getting it wrong is showing
// somebody the wrong sentence, and the wrong sentence still tells the truth.
export function isAndroidAgent(userAgent) {
  const ua = String(userAgent || '');
  if (!/android/i.test(ua)) return false;
  // Windows sends "Windows NT" and never Android; this only guards against a
  // user agent that mentions both, which is always a spoof or a bot.
  if (/windows nt/i.test(ua)) return false;
  return true;
}

// "5.1 MB". Whole megabytes read as suspiciously round for a binary.
export function formatApkSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ANDROID_ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M17.6 9.48l1.84-3.18a.42.42 0 00-.73-.42l-1.86 3.23a11.05 11.05 0 00-9.7 0L5.29 5.88a.42.42 0 00-.73.42L6.4 9.48A10.6 10.6 0 001 18h22a10.6 10.6 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 111.25-1.25A1.25 1.25 0 017 15.25zm10 0a1.25 1.25 0 111.25-1.25A1.25 1.25 0 0117 15.25z"/></svg>';

const DOWNLOAD_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

// The markup for the app half of the devices bar.
//
// The same button either way, because an app that exists should look like it
// exists on every device somebody might be reading this on. Only where it
// goes changes: on Android to the file, and everywhere else to a panel that
// explains why not — which is a better place for that sentence than under the
// button, where it sat as a permanent apology to people who had not asked.
//
// The panel is opened by :target, not by script. Nothing on this page can
// rely on JavaScript; the hub proxy removes it. The lightboxes further down
// work the same way.
export function appDownloadHtml({ origin, isAndroid, sizeBytes }) {
  const size = formatApkSize(sizeBytes);

  const href = isAndroid
    ? `${String(origin || '').replace(/\/$/, '')}/downloads/taxify.apk`
    : '#android-only';

  return (
    `<a class="devices-app devices-get" href="${escapeAttribute(href)}"${isAndroid ? ' download' : ''}>` +
    ANDROID_ICON +
    '<span class="devices-get-label">Get the Android app' +
    `<span class="devices-app-note">${
      isAndroid ? `Installs directly${size ? ` &middot; ${size}` : ''}` : 'Android only &mdash; what about my phone?'
    }</span>` +
    '</span>' +
    (isAndroid ? DOWNLOAD_ICON : '') +
    '</a>'
  );
}

// Fills the marked block, or removes it when there is no APK to offer — an
// empty slot in the middle of that bar would leave a divider with nothing
// after it.
export function injectAppDownload(html, config) {
  const markers = /<!--APPDL-START-->[\s\S]*?<!--APPDL-END-->/;
  if (!markers.test(html)) return html;
  if (!config || !config.available) return html.replace(markers, '');
  return html.replace(markers, `<!--APPDL-START-->${appDownloadHtml(config)}<!--APPDL-END-->`);
}
