import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_PATTERN,
} from './emailAddress.js';

// The bug these exist for.
//
// A copy of this pattern lost its backslashes and became [^s@], which excludes
// the letter s rather than whitespace. Every address with an s in the local
// part was rejected, and because the caller was a "does this person have an
// account" lookup, the answer it gave was "no" — indistinguishable from the
// truth. The first four cases are the ones that were broken.

// The dot has to be a real dot. Unescaped it matches any character, so
// "a@bXcom" would pass — which is how the mangled copy read.

// Shared regexes with /g keep lastIndex between calls and alternate true and
// false on the same input. This one has no flags; the test says so out loud
// because it is the kind of thing added later without thinking.
test('the pattern is stateless across calls', () => {
  assert.equal(EMAIL_PATTERN.flags, '');
  assert.equal(EMAIL_PATTERN.test('sam@firm.com'), true);
  assert.equal(EMAIL_PATTERN.test('sam@firm.com'), true);
});
