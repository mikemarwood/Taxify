import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeEmail, normaliseEmail, EMAIL_PATTERN } from './emailAddress.js';

// The bug these exist for.
//
// A copy of this pattern lost its backslashes and became [^s@], which excludes
// the letter s rather than whitespace. Every address with an s in the local
// part was rejected, and because the caller was a "does this person have an
// account" lookup, the answer it gave was "no" — indistinguishable from the
// truth. The first four cases are the ones that were broken.
test('accepts addresses containing the letter s', () => {
  for (const address of ['sam@firm.com', 'chris@firm.com', 'james@smiths.com', 'sss@sss.com']) {
    assert.equal(looksLikeEmail(address), true, address);
  }
});

test('accepts ordinary addresses', () => {
  for (const address of ['a@b.co', 'mike.marwood@hotmail.com', "o'neill@tax.ie", 'x+tag@sub.domain.com']) {
    assert.equal(looksLikeEmail(address), true, address);
  }
});

test('rejects what is not an address', () => {
  for (const bad of ['', '   ', 'nope', 'no@domain', 'no domain@x.com', 'two@@x.com', '@x.com', 'a@.com']) {
    assert.equal(looksLikeEmail(bad), false, JSON.stringify(bad));
  }
});

// The dot has to be a real dot. Unescaped it matches any character, so
// "a@bXcom" would pass — which is how the mangled copy read.
test('the separator before the domain suffix is a literal dot', () => {
  assert.equal(looksLikeEmail('a@bXcom'), false);
  assert.equal(looksLikeEmail('a@b.com'), true);
});

test('whitespace is excluded, which is what the class is for', () => {
  assert.equal(looksLikeEmail('a b@c.com'), false);
  assert.equal(looksLikeEmail('a@b c.com'), false);
  assert.equal(looksLikeEmail('a@b.c om'), false);
});

test('surrounding whitespace is trimmed rather than rejected', () => {
  assert.equal(looksLikeEmail('  sam@firm.com  '), true);
});

test('normalise lowercases and trims, because SQL matches exactly', () => {
  assert.equal(normaliseEmail('  SAM@Firm.COM '), 'sam@firm.com');
  assert.equal(normaliseEmail(null), '');
  assert.equal(normaliseEmail(undefined), '');
});

// Shared regexes with /g keep lastIndex between calls and alternate true and
// false on the same input. This one has no flags; the test says so out loud
// because it is the kind of thing added later without thinking.
test('the pattern is stateless across calls', () => {
  assert.equal(EMAIL_PATTERN.flags, '');
  assert.equal(EMAIL_PATTERN.test('sam@firm.com'), true);
  assert.equal(EMAIL_PATTERN.test('sam@firm.com'), true);
});
