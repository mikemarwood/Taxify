// One email pattern for the whole server.
//
// There were five copies of this regex, and one of them was wrong. The copy in
// the accountant lookup had lost its backslashes — [^s@] where it meant
// [^\s@] — so instead of excluding whitespace it excluded the letter s, and
// every address with an s before the @ failed it. sam@, chris@, james@, anyone
// at a firm with an s in its name: the lookup answered "no account", the form
// offered the wrong button, and there was nothing to see that would explain it.
//
// A copy is a thing that can be wrong on its own, so there is one now, and it
// has tests. Deliberately loose — it is a shape check, not a proof that a
// mailbox exists, and the only proof of that is a link arriving at it.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function looksLikeEmail(value) {
  return EMAIL_PATTERN.test(String(value || '').trim());
}

// The form the database holds and every comparison uses. Addresses are matched
// exactly in SQL, so a stray capital or a trailing space is a lookup that finds
// nothing for a reason nobody can see.
export function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}
