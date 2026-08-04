import { financialYearRange, normaliseRule, financialYearOf } from './financialYear.js';

// When a set of books is lodged.
//
// An individual lodges once a year. A small business may lodge every quarter,
// and its quarters are not January-to-March — they run from the start of its
// own financial year. An Australian business gets Jul-Sep, Oct-Dec, Jan-Mar,
// Apr-Jun, which are the BAS quarters; a British one gets 6 Apr to 5 Jul.
// Neither is a special case here: both fall out of asking the account's own
// rule where its year begins.
//
// The mirror of server/src/lib/lodgementPeriods.js. The two must agree exactly:
// the server decides what a period IS, and the client decides which expenses
// fall in it when it draws the panel. A server test imports this file and
// compares every rule, year and cadence against its own.

export const CADENCES = ['annual', 'quarterly'];
export const ANNUAL_PERIOD = 'FY';
export const QUARTER_PERIODS = ['Q1', 'Q2', 'Q3', 'Q4'];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

function iso(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Anything unrecognised becomes annual. One lodgement is never more wrong than
// four: showing somebody a single row they don't need beats inventing three
// deadlines they never had.
export function normaliseCadence(value) {
  return CADENCES.includes(String(value || '')) ? String(value) : 'annual';
}

// These end up inside a database key, so they are refused rather than tidied.
export function isPeriod(value) {
  return value === ANNUAL_PERIOD || QUARTER_PERIODS.includes(value);
}

// The periods a financial year is lodged in, in order.
//
//   lodgementPeriodsFor('2025-2026', { startMonth: 7, startDay: 1 }, 'quarterly')
//     Q1 2025-07-01..2025-09-30   Q2 2025-10-01..2025-12-31
//     Q3 2026-01-01..2026-03-31   Q4 2026-04-01..2026-06-30
//
// Returns [] for a label that will not parse, rather than guessing a year.
export function lodgementPeriodsFor(financialYear, rule, cadence) {
  const range = financialYearRange(financialYear, rule);
  if (!range) return [];

  if (normaliseCadence(cadence) === 'annual') {
    return [{ period: ANNUAL_PERIOD, label: `FY ${financialYear}`, start: range.start, end: range.end }];
  }

  const r = normaliseRule(rule);
  const startYear = Number(String(financialYear).slice(0, 4));

  // Each quarter ends the day before the next one begins — the same derivation
  // financialYearRange uses, and the reason the UK's 6 April produces 5 July
  // with no special case. February's length is never computed, so a leap year
  // is handled by not asking. normaliseRule caps startDay at 28, so adding
  // three months can never land on a day that does not exist; the absence of
  // clamping here is deliberate, not an oversight.
  const boundary = (index) => new Date(Date.UTC(startYear, r.startMonth - 1 + index * 3, r.startDay));

  return QUARTER_PERIODS.map((period, i) => {
    const start = boundary(i);
    const end = new Date(boundary(i + 1).getTime() - DAY_MS);
    return {
      period,
      label: quarterLabel(start, end),
      start: iso(start),
      end: iso(end),
    };
  });
}

// "Jul – Sep 2025", or "6 Apr – 5 Jul 2025" when the year does not start on the
// first of a month, because then the day is the part that matters.
function quarterLabel(start, end) {
  const startMonth = MONTH_NAMES[start.getUTCMonth()];
  const endMonth = MONTH_NAMES[end.getUTCMonth()];
  if (start.getUTCDate() === 1) {
    return `${startMonth} – ${endMonth} ${end.getUTCFullYear()}`;
  }
  return `${start.getUTCDate()} ${startMonth} – ${end.getUTCDate()} ${endMonth} ${end.getUTCFullYear()}`;
}

// Which period a date falls in. Null when the date is outside that year —
// never the nearest quarter, because a date in the wrong year is a mistake
// worth surfacing rather than filing somewhere plausible.
export function lodgementPeriodOf(date, financialYear, rule, cadence) {
  const day = String(date || '').slice(0, 10);
  if (!day) return null;
  const found = lodgementPeriodsFor(financialYear, rule, cadence).find((p) => day >= p.start && day <= p.end);
  return found ? found.period : null;
}

// One period's range, or null if this year and cadence have no such period.
export function lodgementPeriodRange(financialYear, rule, cadence, period) {
  const found = lodgementPeriodsFor(financialYear, rule, cadence).find((p) => p.period === period);
  return found ? { start: found.start, end: found.end } : null;
}

// The (year, period) pairs a set of dates touches, deduplicated.
//
// Used to decide whether a write lands in a closed lodgement. Moving an expense
// across a quarter boundary touches two, which is why this takes a list: both
// the period it is leaving and the one it is joining have to be open.
export function periodsCovering(dates, rule, cadence) {
  const seen = new Map();
  for (const date of dates) {
    const day = String(date || '').slice(0, 10);
    if (!day) continue;
    const financialYear = financialYearOf(day, rule);
    if (!financialYear) continue;
    const period = lodgementPeriodOf(day, financialYear, rule, cadence);
    if (!period) continue;
    seen.set(`${financialYear}|${period}`, { financialYear, period });
  }
  return [...seen.values()];
}
