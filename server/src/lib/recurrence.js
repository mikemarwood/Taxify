// Advances a YYYY-MM-DD date string by one period of the given frequency.
// Uses UTC date math so it's unaffected by server timezone, consistent with
// financialYear.js.

function daysInMonth(year, monthIndex) {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Adds whole months, clamping to the end of the target month.
//
// `setUTCMonth` does not do this: from 31 January it produces 31 February,
// which rolls forward to 3 March. That skipped February entirely and then
// stuck every later occurrence on the 3rd. Worse, 31 May advanced to 1 July —
// past the end of the Australian financial year — so a monthly bill quietly
// filed itself into the wrong tax year.
function addMonths(date, count) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonth = month + count;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalisedMonth = ((targetMonth % 12) + 12) % 12;

  return new Date(Date.UTC(targetYear, normalisedMonth, Math.min(day, daysInMonth(targetYear, normalisedMonth))));
}

export function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;

  switch (frequency) {
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    case 'quarterly':
      return addMonths(d, 3).toISOString().slice(0, 10);
    case 'yearly':
      // 29 February has no counterpart in a common year; 28 February is the
      // answer everyone means.
      return addMonths(d, 12).toISOString().slice(0, 10);
    case 'monthly':
    default:
      return addMonths(d, 1).toISOString().slice(0, 10);
  }
}
