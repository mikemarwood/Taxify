import test from 'node:test';
import assert from 'node:assert/strict';
import { toTitleCase } from './text.js';

// A small function with a disproportionate blast radius: the categories route
// feeds its output into a folder name and then renames directory trees on
// disk. Idempotency is the property that matters — re-saving a category must
// not move its files a second time.

test('it title-cases ordinary names', () => {
  assert.equal(toTitleCase('office supplies'), 'Office Supplies');
  assert.equal(toTitleCase('TOOLING'), 'Tooling');
});

test('it is idempotent', () => {
  for (const input of ['office supplies', 'TOOLING', 'home  office', "mcdonald's", 'ABC Pty Ltd', '']) {
    const once = toTitleCase(input);
    assert.equal(toTitleCase(once), once, `f(f(${JSON.stringify(input)})) should equal f(x)`);
  }
});

test('it handles empty and whitespace input without throwing', () => {
  assert.equal(typeof toTitleCase(''), 'string');
  assert.equal(typeof toTitleCase(null), 'string');
  assert.equal(typeof toTitleCase(undefined), 'string');
});

test('known surprises are pinned so they are chosen rather than discovered', () => {
  // Neither of these is what a human would write, but both are stable, and a
  // folder rename depends on them staying stable.
  assert.equal(toTitleCase('ABC Pty Ltd'), 'Abc Pty Ltd');
  assert.equal(toTitleCase("mcdonald's"), "Mcdonald'S");
});
