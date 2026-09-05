import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampDay,
  daysInMonth,
  firstWeekdayIndex,
  isOutOfRange,
  monthGrid,
  openingMonth,
  parseIso,
  shiftMonth,
  toIso,
  yearsBetween,
} from './calendar.js';

test('a date is three numbers, never a Date built from a string', () => {
  assert.deepEqual(parseIso('2026-03-01'), { year: 2026, month: 3, day: 1 });

  // The bug this file exists to avoid: new Date('2026-03-01') is UTC midnight,
  // and .getDate() on it answers 28 February anywhere west of Greenwich. The
  // parse above must give 1 March in every timezone, and it does because it
  // never builds a Date at all.
  assert.equal(parseIso('2026-03-01').day, 1);
  assert.equal(parseIso('2026-01-01').year, 2026);
});

test('a date that does not exist is refused, not rolled over', () => {
  // JavaScript would call this 3 March. It is a mistake, and moving somebody's
  // date silently is worse than ignoring it.
  assert.equal(parseIso('2026-02-31'), null);
  assert.equal(parseIso('2026-13-01'), null);
  assert.equal(parseIso('2026-00-10'), null);
  assert.equal(parseIso('2026-04-31'), null);
  assert.equal(parseIso(''), null);
  assert.equal(parseIso(null), null);
  assert.equal(parseIso('01/03/2026'), null);

  // The last day of each of the awkward ones is fine.
  assert.ok(parseIso('2026-02-28'));
  assert.ok(parseIso('2024-02-29')); // a leap year
  assert.equal(parseIso('2026-02-29'), null); // not one
});

test('month lengths, including the leap years that catch people out', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2000, 2), 29); // divisible by 400
  assert.equal(daysInMonth(1900, 2), 28); // divisible by 100 but not 400
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test('weeks start on Monday', () => {
  // 1 March 2026 is a Sunday, so it sits in the last column.
  assert.equal(firstWeekdayIndex(2026, 3), 6);
  // 1 June 2026 is a Monday, the first column.
  assert.equal(firstWeekdayIndex(2026, 6), 0);
});

test('the grid is always six rows, whatever the month', () => {
  for (const [y, m] of [[2026, 2], [2026, 3], [2026, 8], [2024, 2]]) {
    const grid = monthGrid(y, m);
    assert.equal(grid.length, 42, `${y}-${m}`);
    const days = grid.filter(Boolean);
    assert.equal(days.length, daysInMonth(y, m));
    assert.equal(days[0].day, 1);
    assert.equal(days[days.length - 1].day, daysInMonth(y, m));
  }
  // A fixed height is what stops the buttons under the grid moving every time
  // somebody steps a month.
  const feb = monthGrid(2026, 2);
  assert.equal(feb[0], null);
  assert.equal(feb.filter((c) => c === null).length, 42 - 28);
});

test('stepping a month carries the year', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, 0), { year: 2026, month: 6 });
  assert.deepEqual(shiftMonth(2026, 1, -13), { year: 2024, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, 18), { year: 2027, month: 12 });
});

test('range checks compare ISO dates as the strings they are', () => {
  assert.equal(isOutOfRange('2026-03-01', '2026-01-01', '2026-12-31'), false);
  assert.equal(isOutOfRange('2025-12-31', '2026-01-01', null), true);
  assert.equal(isOutOfRange('2027-01-01', null, '2026-12-31'), true);
  // No bounds means nothing is out of range.
  assert.equal(isOutOfRange('1900-01-01', null, null), false);
  // The bounds themselves are allowed.
  assert.equal(isOutOfRange('2026-01-01', '2026-01-01', '2026-12-31'), false);
  assert.equal(isOutOfRange('2026-12-31', '2026-01-01', '2026-12-31'), false);
});

test('the day is kept when the month changes, or clamped when it cannot be', () => {
  assert.equal(clampDay(2026, 3, 15), 15);
  // The 31st of January stepped to February is the 28th, not the 3rd of March.
  assert.equal(clampDay(2026, 2, 31), 28);
  assert.equal(clampDay(2024, 2, 31), 29);
  assert.equal(clampDay(2026, 4, 31), 30);
});

test('an empty field opens somewhere it will accept', () => {
  const today = '2026-09-05';

  // The ordinary case.
  assert.deepEqual(openingMonth('', { min: null, max: null, today }), { year: 2026, month: 9 });

  // The value wins whenever there is one.
  assert.deepEqual(openingMonth('1988-04-11', { min: null, max: null, today }), { year: 1988, month: 4 });

  // A date of birth: the range ends years ago, so opening on today would show
  // a grid with every day disabled.
  assert.deepEqual(openingMonth('', { min: '1926-01-01', max: '2010-09-05', today }), { year: 2010, month: 9 });

  // And the other way, for a range that has not started yet.
  assert.deepEqual(openingMonth('', { min: '2027-01-01', max: null, today }), { year: 2027, month: 1 });
});

test('toIso pads, and round-trips with parseIso', () => {
  assert.equal(toIso(2026, 3, 1), '2026-03-01');
  assert.equal(toIso(2026, 12, 25), '2026-12-25');
  const p = parseIso('2026-07-04');
  assert.equal(toIso(p.year, p.month, p.day), '2026-07-04');
});

test('the year list runs oldest first', () => {
  assert.deepEqual(yearsBetween(2024, 2027), [2024, 2025, 2026, 2027]);
  assert.deepEqual(yearsBetween(2026, 2026), [2026]);
  assert.deepEqual(yearsBetween(2027, 2026), []);
});
