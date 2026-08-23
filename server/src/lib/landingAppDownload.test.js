import test from 'node:test';
import assert from 'node:assert/strict';
import { injectAppDownload, appDownloadHtml, isAndroidAgent, formatApkSize } from './landingAppDownload.js';

const PAGE = '<div class="bar"><!--APPDL-START--><!--APPDL-END--></div>';
const BASE = { origin: 'https://taxify.mikesapphub.com', available: true, sizeBytes: 5304022 };

test('an Android phone is offered the download', () => {
  const out = injectAppDownload(PAGE, { ...BASE, isAndroid: true });
  assert.match(out, /Get the Android app/);
  assert.match(out, /downloads\/taxify\.apk/);
  assert.match(out, /download/);
});

test('everybody else gets the same button, pointed at the explanation', () => {
  const out = injectAppDownload(PAGE, { ...BASE, isAndroid: false });
  // The same words, so the app looks like it exists whatever you are on.
  assert.match(out, /Get the Android app/);
  assert.match(out, /href="#android-only"/);
  assert.ok(!out.includes('taxify.apk'), 'no APK link off Android');
  assert.ok(!/ download/.test(out), 'nothing to download here');
});

test('the link is absolute, because a relative one lands on the hub', () => {
  // The hub rewrites a relative href to its own domain: /app/terms reaches
  // real visitors as https://mikesapphub.com/terms. A relative APK path would
  // point at a file the hub does not have.
  const out = injectAppDownload(PAGE, { ...BASE, isAndroid: true });
  assert.match(out, /href="https:\/\/taxify\.mikesapphub\.com\/downloads\/taxify\.apk"/);
});

test('a trailing slash on the origin does not double up', () => {
  const out = appDownloadHtml({ origin: 'https://taxify.mikesapphub.com/', isAndroid: true, sizeBytes: 1 });
  assert.ok(!out.includes('com//downloads'));
});

test('the size is shown, and rounded the way a file size is read', () => {
  assert.equal(formatApkSize(5304022), '5.1 MB');
  assert.match(appDownloadHtml({ ...BASE, isAndroid: true }), /5\.1 MB/);
});

test('an unknown size is left out rather than shown as zero', () => {
  assert.equal(formatApkSize(0), null);
  assert.equal(formatApkSize(undefined), null);
  const out = appDownloadHtml({ origin: 'https://x.test', isAndroid: true, sizeBytes: null });
  assert.match(out, /Installs directly/);
  assert.ok(!out.includes('MB'));
});

test('the whole block goes when there is no APK on disk', () => {
  // An empty slot would leave the bar with a divider and nothing after it.
  assert.equal(injectAppDownload(PAGE, { ...BASE, available: false }), '<div class="bar"></div>');
  assert.equal(injectAppDownload(PAGE, null), '<div class="bar"></div>');
});

test('a page without the markers is left alone', () => {
  const plain = '<p>nothing here</p>';
  assert.equal(injectAppDownload(plain, { ...BASE, isAndroid: true }), plain);
});

test('recognises the phones people actually use', () => {
  assert.equal(isAndroidAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'), true);
  assert.equal(isAndroidAgent('Mozilla/5.0 (Linux; Android 13; SM-S911B) Chrome/120'), true);
  // Our own app, which is a webview on Android.
  assert.equal(isAndroidAgent('Mozilla/5.0 (Linux; Android 14) TaxifyAndroid/5'), true);
});

test('does not mistake an iPhone, a Mac or a PC for a phone', () => {
  assert.equal(isAndroidAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), false);
  assert.equal(isAndroidAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), false);
  assert.equal(isAndroidAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
  assert.equal(isAndroidAgent('Mozilla/5.0 (Windows NT 10.0) AndroidStudio/2024'), false);
  assert.equal(isAndroidAgent(''), false);
  assert.equal(isAndroidAgent(undefined), false);
});

test('escapes the origin rather than trusting it', () => {
  const out = appDownloadHtml({ origin: 'https://x.test/"><script>alert(1)</script>', isAndroid: true, sizeBytes: 1 });
  assert.ok(!out.includes('<script>'));
});
