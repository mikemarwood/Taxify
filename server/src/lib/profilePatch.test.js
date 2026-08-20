import test from 'node:test';
import assert from 'node:assert/strict';
import { wasSent, mergedName, buildProfileUpdate } from './profilePatch.js';

// The bug: the accountant setup panel sends only a practice name and was
// refused for a first name it never mentioned.
test('a field nobody sent was not sent', () => {
  const body = { practiceName: 'Chen & Co' };
  assert.equal(wasSent(body, 'practiceName'), true);
  assert.equal(wasSent(body, 'firstName'), false);
  assert.equal(wasSent(body, 'currency'), false);
});

// The distinction the whole thing turns on. A falsy check cannot make it, which
// is how these came to be treated the same.
test('sent-but-empty is still sent', () => {
  assert.equal(wasSent({ firstName: '' }, 'firstName'), true);
  assert.equal(wasSent({ firstName: null }, 'firstName'), true);
  assert.equal(wasSent({ firstName: 0 }, 'firstName'), true);
  assert.equal(wasSent({ firstName: undefined }, 'firstName'), true);
});

test('a missing body is not a crash', () => {
  assert.equal(wasSent(undefined, 'firstName'), false);
  assert.equal(wasSent(null, 'firstName'), false);
});

// Inherited names are not sent names. Without hasOwnProperty, every object in
// JavaScript "has" toString and constructor.
test('inherited properties do not count as sent', () => {
  assert.equal(wasSent({}, 'toString'), false);
  assert.equal(wasSent({}, 'constructor'), false);
});

test('a name half that was not sent is kept', () => {
  const current = { firstName: 'Mike', lastName: 'Marwood' };
  assert.deepEqual(mergedName({ lastName: 'Marwood-Smith' }, current), {
    first: 'Mike',
    last: 'Marwood-Smith',
    full: 'Mike Marwood-Smith',
  });
});

test('sending neither half leaves the name exactly as it was', () => {
  const current = { firstName: 'Mike', lastName: 'Marwood' };
  assert.deepEqual(mergedName({ practiceName: 'Chen & Co' }, current), {
    first: 'Mike',
    last: 'Marwood',
    full: 'Mike Marwood',
  });
});

test('an account with no name on it does not produce "undefined undefined"', () => {
  assert.deepEqual(mergedName({}, {}), { first: '', last: '', full: '' });
  assert.deepEqual(mergedName({}, null), { first: '', last: '', full: '' });
});

test('only the fields that were sent reach the statement', () => {
  const { sets, values } = buildProfileUpdate([
    ['name', undefined],
    ['practice_name', 'Chen & Co'],
    ['phone', undefined],
    ['business_name', null],
  ]);
  assert.deepEqual(sets, ['practice_name = ?', 'business_name = ?']);
  assert.deepEqual(values, ['Chen & Co', null]);
});

// null clears a field and undefined leaves it alone. They are not the same, and
// a build that dropped both would make clearing a firm name impossible.
test('null is a value to write, undefined is a field to skip', () => {
  const { sets, values } = buildProfileUpdate([['practice_name', null]]);
  assert.deepEqual(sets, ['practice_name = ?']);
  assert.deepEqual(values, [null]);
});

test('nothing sent produces nothing to run', () => {
  const { sets, values } = buildProfileUpdate([['name', undefined], ['phone', undefined]]);
  assert.deepEqual(sets, []);
  assert.deepEqual(values, []);
});
