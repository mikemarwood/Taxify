import test from 'node:test';
import assert from 'node:assert/strict';
import { isFutureDate, FUTURE_DATE_MESSAGE } from './expenseDate.js';

const NOW = new Date('2026-08-24T02:00:00Z');

test('today and the past are fine', () => {
  // Receipts arrive late — a shoebox cleared out in July is full of last
  // October — so there is no lower bound at all, and there must not be.
  for (const date of ['2026-08-24', '2026-08-23', '2026-06-30', '2019-01-01']) {
    assert.equal(isFutureDate(date, NOW), false, date);
  }
});

test('a year mistyped forward is refused', () => {
  // The one this exists for. 2027 keyed instead of 2026 files the expense into
  // a financial year that has not started: gone from this year's total, absent
  // from the accountant's export, and the owner has no reason to look for it.
  assert.equal(isFutureDate('2027-08-24', NOW), true);
  assert.equal(isFutureDate('2026-09-30', NOW), true);
});

test('a day of slack, because clocks and timezones disagree', () => {
  // Australia runs up to eleven hours ahead of UTC. Somebody entering a
  // receipt on Tuesday evening in Perth is on a server that still calls it
  // Tuesday morning. Refusing to the exact day would reject ordinary entries
  // for a slice of every single day, which is worse than letting a real typo
  // through by twenty-four hours.
  assert.equal(isFutureDate('2026-08-25', NOW), false, 'tomorrow is allowed');
  assert.equal(isFutureDate('2026-08-26', NOW), true, 'the day after is not');
});

test('the grace runs to the end of the day, not the same hour', () => {
  // Otherwise the limit would move through the day and the same date would be
  // accepted in the morning and refused in the evening.
  assert.equal(isFutureDate('2026-08-25T23:00:00Z', NOW), false);
  assert.equal(isFutureDate('2026-08-26T00:30:00Z', NOW), true);
});

test('nothing, and nonsense, are somebody else’s error', () => {
  // A missing date is already refused as "required" and an unparseable one is
  // refused by the column. Returning true here would report both as "in the
  // future", which is a confusing thing to tell somebody who left a box empty.
  for (const value of ['', null, undefined, 'not a date']) {
    assert.equal(isFutureDate(value, NOW), false, String(value));
  }
});

test('the wording is shared', () => {
  assert.match(FUTURE_DATE_MESSAGE, /future/i);
});
