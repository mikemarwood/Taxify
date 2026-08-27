// A financial year is not the same twelve months everywhere. Australia runs
// 1 July – 30 June, the UK's personal tax year starts 6 April, New Zealand and
// India start 1 April, South Africa 1 March, and much of the world simply uses
// the calendar year. Every date in this app is filed into one of these, so the
// rule has to be a property of the account rather than a constant in the code.
//
// A rule is { startMonth (1-12), startDay }. Everything else is derived.

export const AU_RULE = { startMonth: 7, startDay: 1 };

// The default is Australian because that is what every existing record in the
// database was filed under. A rule is only ever absent for data that predates
// this being configurable, and re-filing it silently would be worse than
// leaving it where it is.
export const DEFAULT_RULE = AU_RULE;

// Countries whose tax year we know. Anything not listed has to be asked about
// rather than guessed — being wrong here misfiles someone's whole history.
export const COUNTRY_FINANCIAL_YEARS = {
  Australia: { startMonth: 7, startDay: 1 },
  'New Zealand': { startMonth: 4, startDay: 1 },
  'United Kingdom': { startMonth: 4, startDay: 6 },
  India: { startMonth: 4, startDay: 1 },
  'South Africa': { startMonth: 3, startDay: 1 },
  Japan: { startMonth: 4, startDay: 1 },
  'United States': { startMonth: 1, startDay: 1 },
  Canada: { startMonth: 1, startDay: 1 },
  Ireland: { startMonth: 1, startDay: 1 },
  Singapore: { startMonth: 1, startDay: 1 },
  Germany: { startMonth: 1, startDay: 1 },
  France: { startMonth: 1, startDay: 1 },
  Netherlands: { startMonth: 1, startDay: 1 },
  Spain: { startMonth: 1, startDay: 1 },
  Italy: { startMonth: 1, startDay: 1 },
  Switzerland: { startMonth: 1, startDay: 1 },
  Sweden: { startMonth: 1, startDay: 1 },
  Norway: { startMonth: 1, startDay: 1 },
  Denmark: { startMonth: 1, startDay: 1 },
  Poland: { startMonth: 1, startDay: 1 },
  Brazil: { startMonth: 1, startDay: 1 },
  Mexico: { startMonth: 1, startDay: 1 },
  'United Arab Emirates': { startMonth: 1, startDay: 1 },
  Malaysia: { startMonth: 1, startDay: 1 },
  Philippines: { startMonth: 1, startDay: 1 },
  Thailand: { startMonth: 1, startDay: 1 },
  Indonesia: { startMonth: 1, startDay: 1 },
  'South Korea': { startMonth: 1, startDay: 1 },
  China: { startMonth: 1, startDay: 1 },
  Israel: { startMonth: 1, startDay: 1 },
  Fiji: { startMonth: 1, startDay: 1 },
};

// Null when we don't know, so the caller can ask instead of assuming.
export function financialYearForCountry(country) {
  return COUNTRY_FINANCIAL_YEARS[String(country || '').trim()] || null;
}

export function normaliseRule(rule) {
  const startMonth = Number(rule?.startMonth);
  const startDay = Number(rule?.startDay);
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) return DEFAULT_RULE;
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) return DEFAULT_RULE;
  return { startMonth, startDay };
}

// A calendar-year country's tax year is "2025", not "2025-2026" — writing the
// latter would be actively wrong on an American's report.
export function isCalendarYear(rule) {
  const r = normaliseRule(rule);
  return r.startMonth === 1 && r.startDay === 1;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Which financial year a date falls in, as a label.
export function financialYearOf(dateStr, rule = DEFAULT_RULE) {
  const r = normaliseRule(rule);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;

  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  // On or after the start date, the year that just began; before it, the one
  // still running.
  const onOrAfterStart = month > r.startMonth || (month === r.startMonth && day >= r.startDay);
  const startYear = onOrAfterStart ? year : year - 1;

  return isCalendarYear(r) ? `${startYear}` : `${startYear}-${startYear + 1}`;
}

export function defaultFinancialYear(rule = DEFAULT_RULE) {
  return financialYearOf(new Date().toISOString().slice(0, 10), rule);
}

// Accepts both shapes so a label written under either rule still parses.
export function isFinancialYearLabel(label) {
  return /^\d{4}(-\d{4})?$/.test(String(label || ''));
}

// The dates a label covers. The end is the day before the next year starts,
// which is what makes 6 April and 1 March work without special cases.
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
