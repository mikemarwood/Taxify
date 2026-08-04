import test from 'node:test';
import assert from 'node:assert/strict';
import { financialYearClause, serialiseYears } from './accountants.js';

// The highest-value test in the codebase. This clause is the only thing
// standing between an accountant granted 2024-2025 and their client's entire
// history, and a regression here is a disclosure bug rather than a glitch.

test('no scope means no restriction', () => {
  assert.equal(financialYearClause(null), null);
  assert.equal(financialYearClause([]), null);
  assert.equal(financialYearClause(undefined), null);
});

test('an unparseable scope fails CLOSED, not open', () => {
  // A scope that was set but resolves to nothing means something is wrong.
  // Showing everything would be the worst possible reading of "they were only
  // given 2024-2025".
  const result = financialYearClause(['garbage']);
  assert.equal(result.clause, '1 = 0');
  assert.deepEqual(result.params, []);
});

test('one year produces one range with two bound parameters', () => {
  const { clause, params } = financialYearClause(['2025-2026']);
  assert.equal(clause, '((e.purchase_date >= ? AND e.purchase_date <= ?))');
  assert.deepEqual(params, ['2025-07-01', '2026-06-30']);
});

test('two years are ORed, in order, with four parameters', () => {
  const { clause, params } = financialYearClause(['2024-2025', '2025-2026']);
  assert.equal(
    clause,
    '((e.purchase_date >= ? AND e.purchase_date <= ?) OR (e.purchase_date >= ? AND e.purchase_date <= ?))'
  );
  assert.deepEqual(params, ['2024-07-01', '2025-06-30', '2025-07-01', '2026-06-30']);
});

test('a junk year among valid ones is dropped, not fatal', () => {
  const { params } = financialYearClause(['2025-2026', 'nope']);
  assert.deepEqual(params, ['2025-07-01', '2026-06-30']);
});

test('the column parameter is honoured', () => {
  const { clause } = financialYearClause(['2025-2026'], 'x.some_date');
  assert.ok(clause.includes('x.some_date >= ?'));
  assert.ok(!clause.includes('e.purchase_date'));
});

test('serialiseYears rejects anything not a year label', () => {
  assert.equal(serialiseYears(null), null);
  assert.equal(serialiseYears([]), null);
  assert.equal(serialiseYears(['bad']), null);
  assert.equal(serialiseYears(['2025-2026']), '2025-2026');
  assert.equal(serialiseYears(['2024-2025', 'bad']), '2024-2025');
});

test('serialiseYears removes duplicates', () => {
  assert.equal(serialiseYears(['2025-2026', '2025-2026']), '2025-2026');
});

// --- The client's own tax year, not ours ---------------------------------

test('a calendar-year account can be granted its year', () => {
  // "2025" is a whole, valid financial year in the United States, Canada,
  // Ireland and most of Europe. The old hyphen-only pattern dropped it, which
  // left the accountant with an empty list — and an empty list means no
  // restriction at all, so refusing the label handed over the whole history.
  assert.equal(serialiseYears(['2025']), '2025');
  assert.equal(serialiseYears(['2025', '2026']), '2025,2026');
  assert.equal(serialiseYears(['2025', '2024-2025']), '2025,2024-2025');
});

test('a year grant is converted using the account rule', () => {
  const calendar = { startMonth: 1, startDay: 1 };
  const { params } = financialYearClause(['2025'], 'e.purchase_date', calendar);
  assert.deepEqual(params, ['2025-01-01', '2025-12-31']);
});

test('the same label means different dates under different rules', () => {
  const au = financialYearClause(['2025-2026'], 'e.purchase_date', { startMonth: 7, startDay: 1 });
  const uk = financialYearClause(['2025-2026'], 'e.purchase_date', { startMonth: 4, startDay: 6 });
  assert.deepEqual(au.params, ['2025-07-01', '2026-06-30']);
  assert.deepEqual(uk.params, ['2025-04-06', '2026-04-05']);
});

test('no rule still behaves as it always did', () => {
  // Existing callers that pass nothing must be unchanged.
  const { params } = financialYearClause(['2025-2026']);
  assert.deepEqual(params, ['2025-07-01', '2026-06-30']);
});

test('every year uses the rule, not its position in the list', () => {
  // years.map(financialYearRange) handed the array index to the rule
  // parameter, so the second and third labels asked for a rule of 1 and 2.
  const calendar = { startMonth: 1, startDay: 1 };
  const { params } = financialYearClause(['2023', '2024', '2025'], 'e.purchase_date', calendar);
  assert.deepEqual(params, [
    '2023-01-01', '2023-12-31',
    '2024-01-01', '2024-12-31',
    '2025-01-01', '2025-12-31',
  ]);
});
