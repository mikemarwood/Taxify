import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooks, parseBookGrant, bookAllowed } from './accountantBooks.js';

test('a stored NULL means every set of books', () => {
  // Every assignment made before this column existed has NULL in it, and each
  // one granted all the books. Reading NULL as "none" would lock out every
  // accountant already working.
  assert.equal(parseBooks(null), null);
  assert.equal(parseBooks(''), null);
});

test('a stored list comes back as numbers', () => {
  assert.deepEqual(parseBooks('4,9'), [4, 9]);
  assert.deepEqual(parseBooks(' 4 , 9 '), [4, 9]);
});

test('an empty choice is refused rather than read as everything', () => {
  // The trap this whole module exists for: "sent no list" and "every id was
  // rejected" look identical at the server, and treating both as null means
  // somebody who picks three books and gets all three wrong hands over the lot.
  const grant = parseBookGrant({ entityIds: [] });
  assert.equal(grant.ok, false);
});

test('books belonging to somebody else are refused', () => {
  const grant = parseBookGrant({ entityIds: [4, 99] }, { availableIds: [4, 9] });
  assert.equal(grant.ok, false);
  assert.match(grant.error, /not yours/);
});

test('choosing every book is stored as all of them', () => {
  // So that adding a fourth set of books later includes it, rather than
  // leaving the new one invisible to an accountant who was given "everything".
  const grant = parseBookGrant({ entityIds: [4, 9] }, { availableIds: [4, 9] });
  assert.deepEqual(grant, { ok: true, value: null });
});

test('a partial choice is stored as a list', () => {
  assert.deepEqual(parseBookGrant({ entityIds: [9] }, { availableIds: [4, 9] }), { ok: true, value: '9' });
});

test('duplicates in the request do not survive', () => {
  assert.deepEqual(parseBookGrant({ entityIds: [9, 9, 9] }, { availableIds: [4, 9] }), { ok: true, value: '9' });
});

test('an older client that says nothing still grants everything', () => {
  // A session open across the deploy sends no such field, and has always
  // granted all the books. It must keep meaning that.
  assert.deepEqual(parseBookGrant({}), { ok: true, value: null });
  assert.deepEqual(parseBookGrant({ allBooks: true }), { ok: true, value: null });
});

test('a grant of null allows any book', () => {
  assert.equal(bookAllowed(null, 4), true);
  assert.equal(bookAllowed(undefined, 4), true);
});

test('a grant of some books refuses the others', () => {
  assert.equal(bookAllowed([9], 9), true);
  assert.equal(bookAllowed([9], 4), false);
  // Ids arrive as strings from headers and query strings.
  assert.equal(bookAllowed([9], '9'), true);
});
