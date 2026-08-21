import { financialYearRange, financialYearOf } from './financialYear.js';

// The earliest date an entry may still be dated.
//
// A finalised year says "this is what I lodged". Adding anything into one
// changes the figures that were signed off, and the server refuses it — but a
// date picker that offers every day back to 1970 and then refuses the press is
// a form that lets somebody choose wrongly and tells them afterwards.
//
// A date input has min and max and nothing in between, so a scattered set of
// closed years cannot be expressed exactly. In practice they close oldest
// first, so the floor is the day after the most recent closed year ends. Where
// they are not contiguous, dateIsClosed below catches the rest — the picker is
// the courtesy and that is the check.
export function earliestOpenDate(finalisedYears, rule) {
  const years = Array.isArray(finalisedYears) ? finalisedYears : [];
  let latestEnd = null;
  for (const year of years) {
    const range = financialYearRange(year, rule);
    if (!range) continue;
    if (!latestEnd || range.end > latestEnd) latestEnd = range.end;
  }
  if (!latestEnd) return undefined;

  // The day after. Built from the parts rather than by adding 86,400,000 to a
  // timestamp, which lands an hour out either side of a daylight-saving change.
  const next = new Date(`${latestEnd}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// Whether a particular date lands in a year that has been signed off. Used for
// the message, and for the gap the min above cannot express.
export function dateIsClosed(date, finalisedYears, rule) {
  if (!date) return false;
  const years = Array.isArray(finalisedYears) ? finalisedYears : [];
  if (years.length === 0) return false;
  const year = financialYearOf(date, rule);
  return years.includes(year);
}
