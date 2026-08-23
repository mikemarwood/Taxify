// Whether offering a download will actually produce a file.
//
// In a browser it always will — saving a file is the browser's job and it has
// been doing it for thirty years. Inside the Android app it depends on the
// build: a webview has no download manager of its own, and until MainActivity
// set a DownloadListener every download in the app silently did nothing. No
// file, no error, no message. A button that behaves like that is worse than no
// button, which is why this exists.
//
// There is no way to ask a webview "will a download work". What there is, is
// the build number the app puts in its own user agent — TaxifyAndroid/<code>,
// set from BuildConfig.VERSION_CODE — so the one thing that reliably
// distinguishes the broken builds from the fixed one is the version itself.

// The first build whose MainActivity sets a DownloadListener. Anything below
// this is an install that cannot save a file however hard it is asked.
export const FIRST_BUILD_WITH_DOWNLOADS = 9;

// The Android app's build number, or null in an ordinary browser.
export function appBuild(userAgent) {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
  const found = /TaxifyAndroid\/(\d+)/i.exec(ua);
  return found ? Number(found[1]) : null;
}

export function downloadsWork(userAgent) {
  const build = appBuild(userAgent);
  if (build === null) return true;
  return build >= FIRST_BUILD_WITH_DOWNLOADS;
}
