// An expense cannot have happened tomorrow.
//
// Both forms cap their date picker at today, but `max` on an <input type=date>
// is a hint to a browser and nothing more: it is not sent, it is not checked,
// and it stops nobody using the API directly. So the rule lives here and is
// enforced on the way in, which is the only place it is actually a rule.
//
// The typo it catches is the expensive one. A receipt keyed 2027 instead of
// 2026 files itself into a financial year that has not started: it disappears
// from this year's total, is not in the export the accountant gets, and the
// owner has no reason to go looking for it because as far as they know they
// entered it. It will surface a year later inside a return nobody is filing
// yet.
//
// Deliberately not "no earlier than X". Receipts arrive late — a shoebox
// cleared out in July is full of last October — and refusing old dates would
// break the main thing this app is for.

// A day of slack, on purpose.
//
// The server's clock, the phone's clock and the customer's timezone are three
// different things. Australia is up to eleven hours ahead of UTC, so somebody
// entering a receipt on Tuesday evening in Perth is on a server that still
// thinks it is Tuesday morning — or Monday. Refusing to the exact day would
// reject perfectly ordinary entries for a slice of every day, which is a far
// worse bug than letting a genuine typo through by twenty-four hours.
const GRACE_DAYS = 1;

export function isFutureDate(value, now = new Date()) {
  if (!value) return false;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return false; // not our error to report

  const limit = new Date(now);
  limit.setUTCDate(limit.getUTCDate() + GRACE_DAYS);
  limit.setUTCHours(23, 59, 59, 999);
  return when.getTime() > limit.getTime();
}

// The message, in one place, so the two routes cannot drift into wording that
// says different things about the same refusal.
export const FUTURE_DATE_MESSAGE = 'That date is in the future. An expense has to have happened already.';
