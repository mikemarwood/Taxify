import test from 'node:test';
import assert from 'node:assert/strict';
import {
  financialYearOf,
  financialYearRange,
  isFinancialYearLabel,
  financialYearForCountry,
  normaliseRule,
} from './financialYear.js';

const AU = { startMonth: 7, startDay: 1 };
const UK = { startMonth: 4, startDay: 6 };
const NZ = { startMonth: 4, startDay: 1 };
const ZA = { startMonth: 3, startDay: 1 };
const US = { startMonth: 1, startDay: 1 };

// Every receipt's folder path, every report row, every accountant's window and
// every closed year derives from these two functions.

test('the Australian year turns over on 1 July', () => {
  assert.equal(financialYearOf('2025-06-30', AU), '2024-2025');
  assert.equal(financialYearOf('2025-07-01', AU), '2025-2026');
});

test('the UK year turns over on 6 April, not the 1st or the 5th', () => {
  assert.equal(financialYearOf('2025-04-05', UK), '2024-2025');
  assert.equal(financialYearOf('2025-04-06', UK), '2025-2026');
});

test('other starts turn over on their own day', () => {
  assert.equal(financialYearOf('2025-03-31', NZ), '2024-2025');
  assert.equal(financialYearOf('2025-04-01', NZ), '2025-2026');
  assert.equal(financialYearOf('2025-02-28', ZA), '2024-2025');
  assert.equal(financialYearOf('2025-03-01', ZA), '2025-2026');
});

test('a calendar-year country gets a single year, not a span', () => {
  assert.equal(financialYearOf('2025-01-01', US), '2025');
  assert.equal(financialYearOf('2025-12-31', US), '2025');
  assert.equal(financialYearOf('2026-01-01', US), '2026');
});

test('a datetime string agrees with a bare date', () => {
  assert.equal(financialYearOf('2025-07-01T00:00:00.000Z', AU), financialYearOf('2025-07-01', AU));
});

test('ranges end the day before the next year begins', () => {
  assert.deepEqual(financialYearRange('2025-2026', AU), { start: '2025-07-01', end: '2026-06-30' });
  assert.deepEqual(financialYearRange('2025-2026', UK), { start: '2025-04-06', end: '2026-04-05' });
  assert.deepEqual(financialYearRange('2025-2026', ZA), { start: '2025-03-01', end: '2026-02-28' });
  assert.deepEqual(financialYearRange('2025', US), { start: '2025-01-01', end: '2025-12-31' });
});

test('a leap year lengthens the South African year correctly', () => {
  assert.deepEqual(financialYearRange('2023-2024', ZA), { start: '2023-03-01', end: '2024-02-29' });
});

test('malformed labels are rejected', () => {
  assert.equal(financialYearRange('2024-2026', AU), null, 'not consecutive');
  assert.equal(financialYearRange('rubbish', AU), null);
  assert.equal(financialYearRange('', AU), null);
});

test('a date round-trips through its own range', () => {
  for (const rule of [AU, UK, NZ, ZA, US]) {
    for (const date of ['2025-01-15', '2025-04-06', '2025-06-30', '2025-07-01', '2025-12-31']) {
      const label = financialYearOf(date, rule);
      const range = financialYearRange(label, rule);
      assert.ok(date >= range.start && date <= range.end, `${date} should sit inside ${label} for this rule`);
    }
  }
});

test('both label shapes are accepted', () => {
  assert.ok(isFinancialYearLabel('2025-2026'));
  assert.ok(isFinancialYearLabel('2025'));
  assert.ok(!isFinancialYearLabel('25-26'));
  assert.ok(!isFinancialYearLabel('nope'));
});

test('an unknown country returns null rather than a guess', () => {
  assert.equal(financialYearForCountry('Australia').startMonth, 7);
  assert.equal(financialYearForCountry('United Kingdom').startDay, 6);
  assert.equal(financialYearForCountry('Nowhere'), null);
});

test('a nonsense rule falls back rather than producing nonsense years', () => {
  assert.deepEqual(normaliseRule({ startMonth: 99, startDay: 0 }), AU);
  assert.deepEqual(normaliseRule(null), AU);
  // Day 29+ is refused: there is no 30 February to clamp to.
  assert.deepEqual(normaliseRule({ startMonth: 2, startDay: 30 }), AU);
});
