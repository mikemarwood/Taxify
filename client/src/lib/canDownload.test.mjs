import test from 'node:test';
import assert from 'node:assert/strict';
import { appBuild, downloadsWork, FIRST_BUILD_WITH_DOWNLOADS } from './canDownload.js';

const OLD_APP = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 TaxifyAndroid/8';
const NEW_APP = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 TaxifyAndroid/${FIRST_BUILD_WITH_DOWNLOADS}`;
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

test('reads the build number out of the app’s user agent', () => {
  assert.equal(appBuild(OLD_APP), 8);
  assert.equal(appBuild(NEW_APP), FIRST_BUILD_WITH_DOWNLOADS);
});

test('a browser is not the app', () => {
  assert.equal(appBuild(CHROME), null);
  assert.equal(appBuild('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), null);
  assert.equal(appBuild(''), null);
});

test('a browser can always download — that is its job', () => {
  assert.equal(downloadsWork(CHROME), true);
  assert.equal(downloadsWork('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), true);
  assert.equal(downloadsWork(''), true);
});

test('the builds that silently swallowed downloads are known to be broken', () => {
  // Before a DownloadListener existed, pressing Download produced no file, no
  // error and nothing in the log.
  assert.equal(downloadsWork(OLD_APP), false);
  assert.equal(downloadsWork('TaxifyAndroid/1'), false);
  assert.equal(downloadsWork('TaxifyAndroid/5'), false);
});

test('the build that fixed it, and everything after, can download', () => {
  assert.equal(downloadsWork(NEW_APP), true);
  assert.equal(downloadsWork('TaxifyAndroid/12'), true);
  assert.equal(downloadsWork('TaxifyAndroid/100'), true);
});
