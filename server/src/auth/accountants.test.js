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
