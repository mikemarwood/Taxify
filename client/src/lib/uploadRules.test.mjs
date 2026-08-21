import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_UPLOAD_BYTES,
  isAllowedUpload,
  uploadProblem,
  fileKind,
} from './uploadRules.js';

const file = (name, type = '', size = 1000) => ({ name, type, size });

test('takes the images people actually photograph receipts with', () => {
  for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.heic', 'a.webp', 'a.avif']) {
    assert.equal(isAllowedUpload(file(name, 'image/jpeg')), true, name);
  }
});

test('takes a HEIC that arrives with no usable MIME type at all', () => {
  // Windows and some browsers report .heic as octet-stream or as nothing.
  assert.equal(isAllowedUpload(file('IMG_0042.HEIC', 'application/octet-stream')), true);
  assert.equal(isAllowedUpload(file('IMG_0042.heic', '')), true);
});

test('takes PDFs and Word documents', () => {
  assert.equal(isAllowedUpload(file('rates.pdf', 'application/pdf')), true);
  assert.equal(isAllowedUpload(file('letter.doc', 'application/msword')), true);
  assert.equal(isAllowedUpload(file('letter.docx', '')), true);
});

test('refuses SVG however it is dressed up', () => {
  // The whole point: an SVG is served back inline from our own origin, so it
  // would run in the owner's session. It also passes any "starts with image/"
  // check, which is how it used to get through.
  assert.equal(isAllowedUpload(file('x.svg', 'image/svg+xml')), false);
  assert.equal(isAllowedUpload(file('x.svgz', '')), false);
  assert.equal(isAllowedUpload(file('innocent.png', 'image/svg+xml')), false);
  assert.equal(isAllowedUpload(file('x.svg', 'image/png')), false);
});

test('refuses everything else', () => {
  assert.equal(isAllowedUpload(file('sheet.xlsx', '')), false);
  assert.equal(isAllowedUpload(file('run.exe', 'application/x-msdownload')), false);
  assert.equal(isAllowedUpload(file('notes.txt', 'text/plain')), false);
  assert.equal(isAllowedUpload(file('')), false);
});

test('names the reason a file cannot be attached', () => {
  assert.match(uploadProblem(file('x.svg', 'image/svg+xml')), /SVG/);
  assert.match(uploadProblem(file('big.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1)), /10MB/);
  assert.equal(uploadProblem(file('ok.pdf', 'application/pdf', MAX_UPLOAD_BYTES)), null);
});

test('shows the kind of file a row holds', () => {
  assert.equal(fileKind('rates.pdf'), 'PDF');
  assert.equal(fileKind('scan.JPEG'), 'JPG');
  assert.equal(fileKind('scan.jpg'), 'JPG');
  assert.equal(fileKind('page.tiff'), 'TIF');
  assert.equal(fileKind('letter.docx'), 'DOCX');
});

test('shows nothing rather than a badge reading FILE', () => {
  assert.equal(fileKind('no-extension'), '');
  assert.equal(fileKind(''), '');
  assert.equal(fileKind(null), '');
});
