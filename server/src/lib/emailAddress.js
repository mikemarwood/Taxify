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

// Only the pattern is exported. Two wrappers sat here — looksLikeEmail and
// normaliseEmail — and every caller reached past them for the regex and did
// its own trim and lower-case, so they were an API nobody adopted.
