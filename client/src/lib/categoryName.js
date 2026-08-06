import { titleCase } from './textCase.js';

// The rules a category name has to satisfy, checked as it is typed.
//
// The server has enforced these all along — the client just never said so, so
// the only way to find out a name was too short or already taken was to press
// the button and be refused. Mirrors server/src/routes/categories.routes.js.

export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 40;

// Typed names are tidied on the way in so "office supplies" and "Office
// Supplies" are recognised as the same thing before the duplicate check runs,
// rather than both being created and looking identical in the list.
export function tidyCategoryName(raw) {
  return titleCase(raw);
}

// Compared case-insensitively and space-insensitively, because "Tools " and
// "tools" are the same category to a person and the unique key agrees.
function normalise(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// `existing` is the names already in the list this one would join. `ignore` is
// the name being edited, so renaming a category from "Tools" to "Tools" is not
// reported as a clash with itself.
export function categoryNameError(name, existing = [], ignore = null) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null; // Nothing typed yet is not an error, just not ready.

  if (trimmed.length < MIN_NAME_LENGTH) return `At least ${MIN_NAME_LENGTH} characters`;
  if (trimmed.length > MAX_NAME_LENGTH) return `${MAX_NAME_LENGTH} characters at most`;

  const target = normalise(trimmed);
  if (ignore && normalise(ignore) === target) return null;
  if (existing.some((e) => normalise(e) === target)) return 'You already have a category with that name';

  return null;
}

// Whether the form can be submitted: something typed, and nothing wrong with
// it. Kept separate from the error so a blank field disables the button
// without showing a complaint about a field nobody has touched.
export function isCategoryNameReady(name, existing = [], ignore = null) {
  return Boolean(String(name ?? '').trim()) && categoryNameError(name, existing, ignore) === null;
}
