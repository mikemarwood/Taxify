import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceDate } from './recurrence.js';

// These are the cases that were wrong before month-end clamping: setUTCMonth
// turns 31 February into 3 March, which skipped a month and then moved every
// later occurrence to the 3rd. The 31 May one is the reason it mattered — it
// produced 1 July, putting a monthly bill in the next financial year.

test('monthly clamps to the end of a shorter month', () => {
  assert.equal(advanceDate('2025-01-31', 'monthly'), '2025-02-28');
  assert.equal(advanceDate('2024-01-31', 'monthly'), '2024-02-29', 'leap year');
  assert.equal(advanceDate('2025-03-31', 'monthly'), '2025-04-30');
});

test('monthly does not cross the financial year boundary', () => {
  // The bug: this used to return 2025-07-01, a different tax year.
  assert.equal(advanceDate('2025-05-31', 'monthly'), '2025-06-30');
});

test('monthly does not drift once it has been clamped', () => {
  let date = '2025-01-31';
  const run = [];
  for (let i = 0; i < 4; i += 1) {
    date = advanceDate(date, 'monthly');
    run.push(date);
  }
  // Clamping is applied from the previous result, so after February the day
  // stays at the 28th rather than returning to the 31st. What must not happen
  // is landing on the 3rd of anything.
  assert.deepEqual(run, ['2025-02-28', '2025-03-28', '2025-04-28', '2025-05-28']);
});

test('ordinary months are untouched', () => {
  assert.equal(advanceDate('2025-01-15', 'monthly'), '2025-02-15');
  assert.equal(advanceDate('2025-12-15', 'monthly'), '2026-01-15', 'across a year boundary');
});

test('weekly adds seven days', () => {
  assert.equal(advanceDate('2025-06-28', 'weekly'), '2025-07-05');
  assert.equal(advanceDate('2024-02-26', 'weekly'), '2024-03-04', 'across a leap February');
});

test('quarterly clamps too', () => {
  assert.equal(advanceDate('2025-01-31', 'quarterly'), '2025-04-30');
  assert.equal(advanceDate('2025-02-15', 'quarterly'), '2025-05-15');
  assert.equal(advanceDate('2025-11-30', 'quarterly'), '2026-02-28', 'across a year boundary');
});

test('yearly handles 29 February', () => {
  assert.equal(advanceDate('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(advanceDate('2025-06-30', 'yearly'), '2026-06-30');
});

test('an unknown frequency behaves as monthly', () => {
  // expenseJobs passes whatever is in the database straight through.
  assert.equal(advanceDate('2025-01-31', undefined), '2025-02-28');
  assert.equal(advanceDate('2025-01-15', 'fortnightly'), '2025-02-15');
});

test('an unparseable date is returned unchanged rather than becoming NaN', () => {
  assert.equal(advanceDate('not-a-date', 'monthly'), 'not-a-date');
});
