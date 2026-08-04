import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lodgementPeriodsFor,
  lodgementPeriodOf,
  lodgementPeriodRange,
  normaliseCadence,
  isPeriod,
  periodsCovering,
} from './lodgementPeriods.js';
import { financialYearRange } from './financialYear.js';

const RULES = {
  AU: { startMonth: 7, startDay: 1 },
  UK: { startMonth: 4, startDay: 6 },
  NZ: { startMonth: 4, startDay: 1 },
  ZA: { startMonth: 3, startDay: 1 },
  US: { startMonth: 1, startDay: 1 },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const nextDay = (iso) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);

test('an annual year is one period covering exactly the year', () => {
  for (const [name, rule] of Object.entries(RULES)) {
    const label = name === 'US' ? '2025' : '2025-2026';
    const periods = lodgementPeriodsFor(label, rule, 'annual');
    const range = financialYearRange(label, rule);
    assert.equal(periods.length, 1, name);
    assert.equal(periods[0].period, 'FY', name);
    assert.equal(periods[0].start, range.start, name);
    assert.equal(periods[0].end, range.end, name);
  }
});

test('the Australian quarters are the BAS quarters', () => {
  const periods = lodgementPeriodsFor('2025-2026', RULES.AU, 'quarterly');
  assert.deepEqual(
    periods.map((p) => [p.period, p.start, p.end]),
    [
      ['Q1', '2025-07-01', '2025-09-30'],
      ['Q2', '2025-10-01', '2025-12-31'],
      ['Q3', '2026-01-01', '2026-03-31'],
      ['Q4', '2026-04-01', '2026-06-30'],
    ]
  );
});

test('a year that starts on the 6th has quarters that end on the 5th', () => {
  // The case a naive "add three months, take the last day" implementation gets
  // wrong. Nothing in the code knows about the 6th; it only ever subtracts a
  // day from the next boundary.
  const periods = lodgementPeriodsFor('2025-2026', RULES.UK, 'quarterly');
  assert.deepEqual(
    periods.map((p) => [p.period, p.start, p.end]),
    [
      ['Q1', '2025-04-06', '2025-07-05'],
      ['Q2', '2025-07-06', '2025-10-05'],
      ['Q3', '2025-10-06', '2026-01-05'],
      ['Q4', '2026-01-06', '2026-04-05'],
    ]
  );
});

test('a calendar-year country quarters its calendar year', () => {
  const periods = lodgementPeriodsFor('2025', RULES.US, 'quarterly');
  assert.deepEqual(
    periods.map((p) => [p.period, p.start, p.end]),
    [
      ['Q1', '2025-01-01', '2025-03-31'],
      ['Q2', '2025-04-01', '2025-06-30'],
      ['Q3', '2025-07-01', '2025-09-30'],
      ['Q4', '2025-10-01', '2025-12-31'],
    ]
  );
});

test('a leap year lengthens the quarter that contains February', () => {
  const leap = lodgementPeriodsFor('2023-2024', RULES.ZA, 'quarterly');
  const ordinary = lodgementPeriodsFor('2024-2025', RULES.ZA, 'quarterly');
  assert.deepEqual([leap[3].start, leap[3].end], ['2023-12-01', '2024-02-29']);
  assert.deepEqual([ordinary[3].start, ordinary[3].end], ['2024-12-01', '2025-02-28']);
});

test('quarters are contiguous and exactly fill the year, for every rule', () => {
  // One looped assertion that catches any off-by-one anywhere in the month
  // arithmetic, rather than trusting five hand-written examples to be complete.
  for (const [name, rule] of Object.entries(RULES)) {
    for (let year = 2019; year <= 2030; year += 1) {
      const label = rule.startMonth === 1 && rule.startDay === 1 ? `${year}` : `${year}-${year + 1}`;
      const periods = lodgementPeriodsFor(label, rule, 'quarterly');
      const range = financialYearRange(label, rule);

      assert.equal(periods.length, 4, `${name} ${label}`);
      assert.equal(periods[0].start, range.start, `${name} ${label} starts with the year`);
      assert.equal(periods[3].end, range.end, `${name} ${label} ends with the year`);
      for (let i = 0; i < 3; i += 1) {
        assert.equal(nextDay(periods[i].end), periods[i + 1].start, `${name} ${label} ${periods[i].period} gap`);
      }
    }
  }
});

test('every day of a year lands in exactly one of its quarters', () => {
  for (const [name, rule] of Object.entries(RULES)) {
    const label = rule.startMonth === 1 && rule.startDay === 1 ? '2025' : '2025-2026';
    const { start, end } = financialYearRange(label, rule);
    for (let t = new Date(`${start}T00:00:00Z`).getTime(); t <= new Date(`${end}T00:00:00Z`).getTime(); t += DAY_MS) {
      const day = new Date(t).toISOString().slice(0, 10);
      const period = lodgementPeriodOf(day, label, rule, 'quarterly');
      assert.ok(period, `${name} ${day} fell in no quarter`);
      const range = lodgementPeriodRange(label, rule, 'quarterly', period);
      assert.ok(day >= range.start && day <= range.end, `${name} ${day} outside ${period}`);
    }
  }
});

test('a date outside the year has no period rather than the nearest one', () => {
  assert.equal(lodgementPeriodOf('2025-06-30', '2025-2026', RULES.AU, 'quarterly'), null);
  assert.equal(lodgementPeriodOf('2026-07-01', '2025-2026', RULES.AU, 'quarterly'), null);
  assert.equal(lodgementPeriodOf('2025-07-01', '2025-2026', RULES.AU, 'quarterly'), 'Q1');
  assert.equal(lodgementPeriodOf('', '2025-2026', RULES.AU, 'quarterly'), null);
  assert.equal(lodgementPeriodOf(null, '2025-2026', RULES.AU, 'quarterly'), null);
});

test('a datetime is treated as its date', () => {
  assert.equal(lodgementPeriodOf('2025-09-30T23:30:00Z', '2025-2026', RULES.AU, 'quarterly'), 'Q1');
  assert.equal(lodgementPeriodOf('2025-10-01T00:30:00Z', '2025-2026', RULES.AU, 'quarterly'), 'Q2');
});

test('an unparseable label gives no periods rather than a guessed year', () => {
  assert.deepEqual(lodgementPeriodsFor('2025-2027', RULES.AU, 'quarterly'), []);
  assert.deepEqual(lodgementPeriodsFor('nonsense', RULES.AU, 'annual'), []);
  assert.deepEqual(lodgementPeriodsFor(null, RULES.AU, 'quarterly'), []);
});

test('an unrecognised cadence is annual, never quarterly', () => {
  assert.equal(normaliseCadence('quarterly'), 'quarterly');
  assert.equal(normaliseCadence('annual'), 'annual');
  for (const bad of ['monthly', 'QUARTERLY', '', null, undefined, 0, {}]) {
    assert.equal(normaliseCadence(bad), 'annual', String(bad));
  }
  assert.equal(lodgementPeriodsFor('2025-2026', RULES.AU, 'weekly').length, 1);
});

test('only real period identifiers are accepted', () => {
  for (const good of ['FY', 'Q1', 'Q2', 'Q3', 'Q4']) assert.equal(isPeriod(good), true, good);
  for (const bad of ['q1', 'Q0', 'Q5', 'fy', '', null, undefined, '2025-2026-Q1', 1]) {
    assert.equal(isPeriod(bad), false, String(bad));
  }
});

test('a rule that cannot exist falls back rather than producing invalid dates', () => {
  // normaliseRule caps the day at 28, so 29 February can never be a year start.
  const periods = lodgementPeriodsFor('2025-2026', { startMonth: 2, startDay: 29 }, 'quarterly');
  assert.equal(periods.length, 4);
  for (const p of periods) {
    assert.match(p.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(p.end, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('periodsCovering reports both sides of a boundary', () => {
  const covering = (dates, cadence) => periodsCovering(dates, RULES.AU, cadence);

  // Two dates inside one quarter are one lodgement.
  assert.equal(covering(['2025-07-05', '2025-08-20'], 'quarterly').length, 1);

  // Either side of a quarter boundary is two — moving an expense across it
  // needs both to be open.
  const across = covering(['2025-09-30', '2025-10-01'], 'quarterly');
  assert.equal(across.length, 2);
  assert.deepEqual(
    across.map((p) => p.period).sort(),
    ['Q1', 'Q2']
  );

  // The same two dates are one lodgement for an entity that lodges annually.
  assert.equal(covering(['2025-09-30', '2025-10-01'], 'annual').length, 1);

  // Across a financial year is two, under either cadence.
  assert.equal(covering(['2025-06-30', '2025-07-01'], 'annual').length, 2);
  assert.equal(covering(['2025-06-30', '2025-07-01'], 'quarterly').length, 2);

  assert.deepEqual(covering([], 'quarterly'), []);
  assert.deepEqual(covering([null, undefined, ''], 'quarterly'), []);
});

test('the client mirror agrees with this one exactly', async () => {
  // The two financialYear.js copies already risk drifting; this one must not.
  // Skipped rather than failed if the client is not present, so the server
  // tests still run on their own.
  let mirror;
  try {
    mirror = await import('../../../client/src/lib/lodgementPeriods.js');
  } catch {
    return;
  }

  for (const rule of Object.values(RULES)) {
    for (let year = 2020; year <= 2030; year += 1) {
      const label = rule.startMonth === 1 && rule.startDay === 1 ? `${year}` : `${year}-${year + 1}`;
      for (const cadence of ['annual', 'quarterly']) {
        assert.deepEqual(
          mirror.lodgementPeriodsFor(label, rule, cadence),
          lodgementPeriodsFor(label, rule, cadence),
          `${label} ${cadence} ${rule.startMonth}/${rule.startDay}`
        );
      }
    }
  }
});
