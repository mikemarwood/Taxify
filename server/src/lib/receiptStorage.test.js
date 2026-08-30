import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  assertWithin,
  categoryToFolderSegment,
  receiptRelDirFor,
  receiptDirFor,
  categoryDocumentDir,
  entityReceiptsRootDir,
} from './receiptStorage.js';
import {
  entityPathSegment,
  writeEntityId,
} from './entities.js';
import {
  isFinancialYearLabel,
} from './financialYear.js';

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

// --- Entities do not move a single existing file --------------------------

test('another entity adds exactly one folder, above the year', () => {
  const AU = { startMonth: 7, startDay: 1 };
  assert.equal(
    receiptDirFor(ROOT, 12, '2025-08-01', 'Tooling', AU, 'acme'),
    path.join(ROOT, '12', 'receipts', 'acme', '2025-2026', 'tooling')
  );
  assert.equal(receiptRelDirFor(12, '2025-08-01', 'Tooling', AU, 'acme'), '12/receipts/acme/2025-2026/tooling');
  assert.equal(
    categoryDocumentDir(ROOT, 12, 'Tooling', '2025-2026', 'acme'),
    path.join(ROOT, '12', 'documents', 'acme', 'tooling', '2025-2026')
  );
  assert.equal(entityReceiptsRootDir(ROOT, 12, 'acme'), path.join(ROOT, '12', 'receipts', 'acme'));
});

test('two entities never share a category folder', () => {
  // The whole point. Without this, renaming one business's "Tooling" moves the
  // other's receipts and repoints only its own rows, and the files become
  // unreachable at any path the app will look at.
  const AU = { startMonth: 7, startDay: 1 };
  const a = receiptDirFor(ROOT, 12, '2025-08-01', 'Tooling', AU, null);
  const b = receiptDirFor(ROOT, 12, '2025-08-01', 'Tooling', AU, 'acme');
  assert.notEqual(a, b);
});

test('a hostile entity segment cannot escape the uploads root', () => {
  const AU = { startMonth: 7, startDay: 1 };
  for (const nasty of ['../../etc', '..', '../', '/etc/passwd', 'C:\Windows', '..\..\secrets']) {
    const dir = receiptDirFor(ROOT, 12, '2025-08-01', 'Tooling', AU, nasty);
    assert.equal(assertWithin(ROOT, dir), dir, `"${nasty}" escaped`);
    const docs = categoryDocumentDir(ROOT, 12, 'Tooling', '2025-2026', nasty);
    assert.equal(assertWithin(ROOT, docs), docs, `"${nasty}" escaped via documents`);
  }
});

test('an entity folder is never mistakable for a year folder', () => {
  // categories.routes reads every child of receipts/ that is not _inbox as a
  // financial year, and a category delete rmSyncs those folders. A business
  // named after a year would be caught by that scan.
  assert.notEqual(entityPathSegment('2025-2026', 9), '2025-2026');
  assert.notEqual(entityPathSegment('2025', 9), '2025');
  assert.notEqual(entityPathSegment('_inbox', 9), '_inbox');
  assert.equal(isFinancialYearLabel(entityPathSegment('2025-2026', 9)), false);
});

test('entity segments are disambiguated and never empty', () => {
  assert.equal(entityPathSegment('Acme Plumbing', 3), 'acme plumbing');
  // A second business of the same name gets the id rather than colliding.
  assert.equal(entityPathSegment('Acme Plumbing', 7, ['acme plumbing']), 'acme plumbing-e7');
  for (const awkward of ['', '///', '...', ':::', '   ']) {
    const segment = entityPathSegment(awkward, 4);
    assert.ok(segment && segment.length > 0, `"${awkward}" produced nothing`);
  }
});

test('writeEntityId refuses the combined view rather than guessing', () => {
  assert.equal(writeEntityId({ entityId: 5 }), 5);
  for (const user of [{ entityId: null }, {}, null, undefined]) {
    assert.throws(() => writeEntityId(user), (err) => err.status === 400);
  }
});
