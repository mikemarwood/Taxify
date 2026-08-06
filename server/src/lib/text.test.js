import test from 'node:test';
import assert from 'node:assert/strict';
import { toTitleCase, titleCase, sentenceCase, lowerEmail } from './text.js';

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

test('the two old surprises are fixed, and stay fixed', () => {
  // These used to be pinned as "stable but not what a human would write".
  // Both were the same bug — lowercasing the whole string before capitalising
  // word starts — and both now come out the way somebody would actually type
  // them. Still pinned, because a receipt folder rename depends on this being
  // stable, and stable is now also correct.
  assert.equal(toTitleCase('ABC Pty Ltd'), 'ABC Pty Ltd');
  // Not "McDonald's" — nothing can know the D is capital from "mcdonald"
  // alone, and guessing would need a dictionary. What matters is that someone
  // who types it properly keeps it: see the test below.
  assert.equal(toTitleCase("mcdonald's"), "Mcdonald's");
});

test('titleCase tidies what is clearly untidy', () => {
  assert.equal(titleCase('john smith'), 'John Smith');
  assert.equal(titleCase('JOHN SMITH'), 'John Smith');
  assert.equal(titleCase('hilux'), 'Hilux');
  assert.equal(titleCase('  ford   RANGER  '), 'Ford Ranger');
});

test('titleCase leaves deliberate capitals alone', () => {
  // The whole reason this is not a one-line regex. Someone whose name really
  // is McDonald should not have to see it spelled wrong every time they open
  // their own account.
  assert.equal(titleCase('Ronald McDonald'), 'Ronald McDonald');
  assert.equal(titleCase('iPhone charger'), 'iPhone Charger');
  assert.equal(titleCase('BMW X5'), 'BMW X5');
});

test('titleCase capitalises after apostrophes and hyphens', () => {
  assert.equal(titleCase("o'brien"), "O'Brien");
  assert.equal(titleCase('smith-jones'), 'Smith-Jones');
  assert.equal(titleCase('mary-jane o’connor'), 'Mary-Jane O’Connor');
});

test('titleCase keeps short initialisms', () => {
  // Lowercasing these would turn a correct abbreviation into a wrong word.
  assert.equal(titleCase('ATO'), 'ATO');
  assert.equal(titleCase('NSW ute'), 'NSW Ute');
  assert.equal(titleCase('GST return'), 'GST Return');
});

test('sentenceCase capitalises openings and nothing else', () => {
  assert.equal(sentenceCase('site visit, parramatta'), 'Site visit, parramatta');
  assert.equal(sentenceCase('drove to site. picked up timber.'), 'Drove to site. Picked up timber.');
  // Lowercasing the remainder would have made this "ato" and "parramatta",
  // which is why only the opening letter is touched.
  assert.equal(sentenceCase('meeting with the ATO in Parramatta'), 'Meeting with the ATO in Parramatta');
});

test('empty values stay empty rather than becoming "undefined"', () => {
  for (const fn of [titleCase, sentenceCase, lowerEmail]) {
    assert.equal(fn(null), '');
    assert.equal(fn(undefined), '');
    assert.equal(fn('   '), '');
  }
});

test('lowerEmail matches how addresses are compared everywhere else', () => {
  assert.equal(lowerEmail('  Mike.Marwood@Hotmail.COM '), 'mike.marwood@hotmail.com');
});
