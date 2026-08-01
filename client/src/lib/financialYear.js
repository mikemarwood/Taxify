// The client files dates into financial years too — for the year selector, for
// which categories a date is offered, for the archive. It must agree with the
// server exactly, so this mirrors server/src/lib/financialYear.js. A rule is
// { startMonth (1-12), startDay }.

export const DEFAULT_RULE = { startMonth: 7, startDay: 1 };

export function normaliseRule(rule) {
  const startMonth = Number(rule?.startMonth);
  const startDay = Number(rule?.startDay);
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) return DEFAULT_RULE;
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) return DEFAULT_RULE;
  return { startMonth, startDay };
}

// A calendar-year country's tax year is "2025", not "2025-2026".
export function isCalendarYear(rule) {
  const r = normaliseRule(rule);
  return r.startMonth === 1 && r.startDay === 1;
}

export function financialYearOf(dateStr, rule = DEFAULT_RULE) {
  const r = normaliseRule(rule);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;

  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  const onOrAfterStart = month > r.startMonth || (month === r.startMonth && day >= r.startDay);
  const startYear = onOrAfterStart ? year : year - 1;

  return isCalendarYear(r) ? `${startYear}` : `${startYear}-${startYear + 1}`;
}

export function currentFinancialYear(rule = DEFAULT_RULE) {
  return financialYearOf(new Date().toISOString(), rule);
}

// Which financial year a page should land on. Defaulting blindly to the
// current one hides everything when the only data is historical — and worse,
// a <select> whose value matches no <option> renders as the first option, so
// the filter silently disagrees with what the dropdown appears to say.
export function defaultFinancialYear(expenses, rule = DEFAULT_RULE) {
  const current = currentFinancialYear(rule);
  if (!expenses || expenses.length === 0) return current;

  const available = new Set(expenses.map((e) => e.financialYear));
  if (available.has(current)) return current;

  // Most recent year that actually has expenses.
  return Array.from(available).sort().reverse()[0] || current;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

// The dates a label covers. Mirrors the server; the end is the day before the
// next year begins, which is what makes 6 April and 1 March work without any
// special cases.
export function financialYearRange(label, rule = DEFAULT_RULE) {
  const r = normaliseRule(rule);
  const text = String(label || '');

  let startYear;
  if (/^\d{4}$/.test(text)) {
    startYear = Number(text);
  } else {
    const match = /^(\d{4})-(\d{4})$/.exec(text);
    if (!match) return null;
    startYear = Number(match[1]);
    if (Number(match[2]) !== startYear + 1) return null;
  }

  const start = new Date(Date.UTC(startYear, r.startMonth - 1, r.startDay));
  const nextStart = new Date(Date.UTC(startYear + 1, r.startMonth - 1, r.startDay));
  const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);

  return {
    start: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`,
    end: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
  };
}

// How a year actually reads: "1 July – 30 June", "6 April – 5 April". Worth
// saying out loud, because what a financial year covers is only obvious inside
// your own country.
//
// Derived from the range rather than computed again here: a year that starts
// on the 6th ends on the 5th of the *same* month, not the previous one, and
// working that out twice is how the two answers drift apart.
export function financialYearSpan(rule = DEFAULT_RULE) {
  const range = financialYearRange('2025-2026', rule);
  if (!range) return '';
  const [, sm, sd] = range.start.split('-').map(Number);
  const [, em, ed] = range.end.split('-').map(Number);
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
}
