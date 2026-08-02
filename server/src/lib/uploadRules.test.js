import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedUpload } from './uploadRules.js';

const file = (originalname, mimetype) => ({ originalname, mimetype });

test('ordinary receipts are accepted', () => {
  assert.ok(isAllowedUpload(file('receipt.jpg', 'image/jpeg')));
  assert.ok(isAllowedUpload(file('receipt.png', 'image/png')));
  assert.ok(isAllowedUpload(file('statement.pdf', 'application/pdf')));
  assert.ok(isAllowedUpload(file('letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')));
});

test('an iPhone photo with a useless MIME type still gets in by extension', () => {
  // The reason the extension fallback exists at all.
  assert.ok(isAllowedUpload(file('IMG_0042.heic', 'application/octet-stream')));
  assert.ok(isAllowedUpload(file('IMG_0042.HEIC', '')));
  assert.ok(isAllowedUpload(file('scan.tiff', undefined)));
});

test('SVG is refused by extension', () => {
  assert.equal(isAllowedUpload(file('logo.svg', 'image/svg+xml')), false);
  assert.equal(isAllowedUpload(file('logo.SVG', 'image/svg+xml')), false);
  assert.equal(isAllowedUpload(file('logo.svgz', 'application/octet-stream')), false);
});

test('SVG is refused by MIME type even when the filename lies', () => {
  // This is the case a naive fix leaves open: `image/svg+xml` satisfies the
  // `startsWith('image/')` branch and never reaches the extension check, so
  // simply dropping '.svg' from the allow-list would change nothing.
  assert.equal(isAllowedUpload(file('harmless.png', 'image/svg+xml')), false);
  assert.equal(isAllowedUpload(file('receipt.jpg', 'IMAGE/SVG+XML')), false, 'case-insensitive');
});

test('unrelated file types are refused', () => {
  assert.equal(isAllowedUpload(file('script.js', 'text/javascript')), false);
  assert.equal(isAllowedUpload(file('archive.zip', 'application/zip')), false);
  assert.equal(isAllowedUpload(file('page.html', 'text/html')), false);
});

test('a missing filename or mimetype does not throw', () => {
  assert.equal(isAllowedUpload({}), false);
  assert.equal(isAllowedUpload(file(undefined, undefined)), false);
});
