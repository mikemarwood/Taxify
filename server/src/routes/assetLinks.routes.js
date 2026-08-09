import { Router } from 'express';

// The file Android reads to decide whether this app may open this site's links.
//
// Every link Taxify emails points at our own host, and the Android app is that
// host loaded in a webview — so a link tapped on a phone with the app installed
// ought to open the app, not a browser it then has to be signed into a second
// time. Android will only do that if it can fetch this file over HTTPS from the
// same host and find the package and signing certificate it is being asked to
// trust.
//
// Served rather than shipped as a static file because the fingerprint is
// deployment data, not source: it is the certificate the APK was actually
// signed with on the build machine, and it changes if the signing key does.
// Baking it into the repo means the day the key rotates, links quietly stop
// opening the app and nothing says why.
//
// Get it with:
//   keytool -list -v -keystore <the keystore used to sign> -alias <alias>
// and put the SHA-256 line in ANDROID_CERT_SHA256 in server/.env. More than one
// can be listed, comma separated — a debug build and a release build have
// different certificates, and during a key rotation both are live at once.

const router = Router();

const PACKAGE = process.env.ANDROID_PACKAGE || 'com.mikesapphub.taxify';

function fingerprints() {
  return String(process.env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    // Android wants the colon-separated hex form. A fingerprint pasted without
    // them is the same certificate and refusing it would be pedantry, so it is
    // put back into shape instead.
    .map((value) => (/^[0-9A-F]{64}$/.test(value) ? value.match(/.{2}/g).join(':') : value))
    .filter((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
}

router.get('/.well-known/assetlinks.json', (req, res) => {
  const certs = fingerprints();

  // An empty list rather than a made-up one. Android reads a malformed or
  // wrong file as "this app may not have these links" and falls back to the
  // browser, which is the same outcome as no file at all — but a 404 is the
  // honest way to say it is not configured yet, and it shows up in a log.
  if (certs.length === 0) {
    return res.status(404).json({
      error: 'App links are not configured. Set ANDROID_CERT_SHA256 in server/.env.',
    });
  }

  // Short cache. Android re-checks this periodically, and a day-long cache on a
  // CDN is how a corrected fingerprint takes a day to take effect.
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/json');
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: PACKAGE,
        sha256_cert_fingerprints: certs,
      },
    },
  ]);
});

export default router;
