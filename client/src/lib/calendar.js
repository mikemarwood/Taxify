// The arithmetic behind a date picker, with no DOM and no clock.
//
// Everything here works on 'YYYY-MM-DD' strings and plain {year, month, day}
// numbers, and never on a Date built from one of those strings. That is the
// whole point of the file.
//
// `new Date('2026-03-01')` is parsed as UTC midnight, and in any timezone west
// of Greenwich `.getDate()` on it answers 28 February. Every calendar bug of
// the "it saved the day before" kind starts there. The app already stores
// dates as bare days with no time in them, so the picker treats them as three
// numbers and does no conversion at all.

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// 'YYYY-MM-DD' → { year, month, day } with month 1–12, or null.
//
// Rejects a date that does not exist rather than rolling it over: '2026-02-31'
// is not the third of March, it is a mistake, and a picker that silently moves
// somebody's date is worse than one that ignores it.
export function parseIso(value) {
  const m = ISO.exec(String(value || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function toIso(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Built from the parts rather than from a string, because this constructor
// takes local values and is the one that does not shift.
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Monday-first, because that is how a week is written here and how every
// calendar on a wall in this country starts.
//
// getDay() is Sunday-first, so 0 becomes 6 and everything else shifts down.
export function firstWeekdayIndex(year, month) {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

// Six rows of seven, always. A month can span four rows or six, and a grid
// that changes height moves the buttons under it every time somebody steps a
// month — so the shape is fixed and the spare cells are empty.
//
// Cells are { day, iso } for this month, or null for the padding.
export function monthGrid(year, month) {
  const total = daysInMonth(year, month);
  const lead = firstWeekdayIndex(year, month);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const day = i - lead + 1;
    cells.push(day >= 1 && day <= total ? { day, iso: toIso(year, month, day) } : null);
  }
  return cells;
}

// One month either way, carrying the year with it.
export function shiftMonth(year, month, by) {
  const zero = year * 12 + (month - 1) + by;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

// Whether a day is outside what the field will accept. Compared as strings,
// which is exactly what an ISO date is for — they sort as they read.
export function isOutOfRange(iso, min, max) {
  if (min && iso < min) return true;
  if (max && iso > max) return true;
  return false;
}

// Keeping the day when the month changes, and not inventing one when it cannot
// be kept.
//
// The 31st of January with the month stepped to February is not the 3rd of
// March; it is the 28th. Clamping is the only answer that stays in the month
// somebody just chose.
export function clampDay(year, month, day) {
  return Math.min(day, daysInMonth(year, month));
}

// The years a picker should offer, oldest first.
//
// Given as a range rather than computed from min/max alone, because a date of
// birth and an expense date want completely different lists — a hundred years
// back for one, a few either side of today for the other — and the field knows
// which it is.
export function yearsBetween(from, to) {
  const out = [];
  for (let y = from; y <= to; y += 1) out.push(y);
  return out;
}

// Where the picker should open when the field is empty.
//
// Not always today. A date of birth whose range ends forty years ago should
// open at the end of its range, not on a month it will not accept — otherwise
// the first thing somebody sees is a grid with every day disabled.
export function openingMonth(value, { min, max, today }) {
  const parsed = parseIso(value);
  if (parsed) return { year: parsed.year, month: parsed.month };
  let iso = today;
  if (max && iso > max) iso = max;
  if (min && iso < min) iso = min;
  const at = parseIso(iso) || parseIso(today);
  return { year: at.year, month: at.month };
}
