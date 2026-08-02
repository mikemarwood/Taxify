import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { assertWithin, categoryToFolderSegment, receiptRelDirFor } from './receiptStorage.js';

// assertWithin is the path-traversal guard on every receipt and document read
// in the app. If it ever stops rejecting, a crafted category name or filename
// reads arbitrary files off the server.

const ROOT = path.resolve('/srv/taxify/uploads');

test('a path inside the root is allowed', () => {
  const inside = path.join(ROOT, '12', 'receipts', '2025-2026', 'Tooling', 'a.jpg');
  assert.equal(assertWithin(ROOT, inside), inside);
});

test('the root itself is allowed', () => {
  assert.equal(assertWithin(ROOT, ROOT), ROOT);
});

test('traversal out of the root is rejected', () => {
  assert.throws(() => assertWithin(ROOT, path.join(ROOT, '..', '..', 'etc', 'passwd')));
  assert.throws(() => assertWithin(ROOT, path.resolve('/etc/passwd')));
});

test('a sibling directory sharing the prefix is rejected', () => {
  // The classic off-by-one: /srv/taxify/uploads-evil starts with the root
  // string but is not inside it.
  assert.throws(() => assertWithin(ROOT, path.resolve('/srv/taxify/uploads-evil/x.jpg')));
});

test('category folder names cannot escape their parent', () => {
  // The property that matters is not "contains no dots" — "../../etc" becomes
  // "....etc", which is an odd folder name but not a traversal, because ".."
  // only means "parent" as a whole path segment. What must hold is that the
  // result stays inside the directory it is joined to.
  for (const nasty of ['../../etc', '..', '../', '/etc/passwd', 'C:\\Windows', '..\\..\\secrets']) {
    const segment = categoryToFolderSegment(nasty);
    const joined = path.join(ROOT, segment);
    assert.equal(assertWithin(ROOT, joined), joined, `"${nasty}" escaped as "${segment}"`);
  }
});

test('characters a filesystem treats specially are removed', () => {
  for (const ch of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
    assert.ok(!categoryToFolderSegment(`Bad${ch}Name`).includes(ch), `should strip ${ch}`);
  }
});

test('a category name that sanitises to nothing still yields a folder', () => {
  assert.ok(categoryToFolderSegment('///').length > 0);
  assert.ok(categoryToFolderSegment('').length > 0);
});

test('the relative path is always forward-slashed', () => {
  // Shown to the user and used in the archive, so it has to read the same on
  // Windows and Linux.
  const rel = receiptRelDirFor(12, '2025-08-01', 'Tooling', { startMonth: 7, startDay: 1 });
  assert.ok(!rel.includes('\\'), rel);
  assert.ok(rel.includes('2025-2026'), rel);
});

test('the relative path follows the account financial year rule', () => {
  const au = receiptRelDirFor(1, '2025-05-01', 'Tooling', { startMonth: 7, startDay: 1 });
  const us = receiptRelDirFor(1, '2025-05-01', 'Tooling', { startMonth: 1, startDay: 1 });
  assert.ok(au.includes('2024-2025'), au);
  assert.ok(us.includes('2025'), us);
});
