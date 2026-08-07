// The length rules for an accountant invitation, in one place.
//
// Mirrors server/src/lib/inviteFields.js, the same way textCase.js and
// financialYear.js are: the client uses them to disable the button and say why
// before anything is sent, and the server enforces them because a disabled
// button stops nobody who is posting directly.

// Two, because there are real one-syllable surnames but no one-letter ones,
// and an initial belongs in a first name rather than instead of it.
export const NAME_MIN = 2;
// Comfortably longer than any name likely to arrive, and short of the column's
// 120 so a rejection is a message rather than a truncation.
export const NAME_MAX = 60;

export const COMPANY_MIN = 2;
export const COMPANY_MAX = 120;

// Runs of whitespace collapse before anything is measured, so a name cannot be
// padded past the floor with spaces, and " " is empty rather than length one.
export function tidy(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

// Returns a message, or '' when the value is fine. A message rather than a
// boolean so the field can say what is wrong instead of only that something
// is.
export function nameProblem(value, label = 'Name') {
  const text = tidy(value);
  if (!text) return `${label} is required`;
  if (text.length < NAME_MIN) return `${label} needs at least ${NAME_MIN} characters`;
  if (text.length > NAME_MAX) return `${label} can be at most ${NAME_MAX} characters`;
  return '';
}

// The company is optional, so an empty one is fine — but a company that *is*
// given still has to be a plausible name rather than a single character.
export function companyProblem(value) {
  const text = tidy(value);
  if (!text) return '';
  if (text.length < COMPANY_MIN) return `Practice or firm name needs at least ${COMPANY_MIN} characters`;
  if (text.length > COMPANY_MAX) return `Practice or firm name can be at most ${COMPANY_MAX} characters`;
  return '';
}

// The first problem across all three, or '' when the whole set is fine.
export function inviteFieldsProblem({ firstName, lastName, companyName }) {
  return (
    nameProblem(firstName, 'First name') ||
    nameProblem(lastName, 'Last name') ||
    companyProblem(companyName) ||
    ''
  );
}
