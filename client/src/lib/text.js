// A capital at the start of every sentence.
//
// Typing into a small field at speed produces lower-case first letters, and
// some of these fields end up on an invoice or in an email where that reads as
// carelessness. Only the letter after a full stop, question mark or
// exclamation is touched — the rest of the line is left exactly as it was
// typed, because "GST", "ATO" and "PAYG" are not spelling mistakes.
//
// The same rule is applied again on the server, in admin.routes.js. Anything
// arriving from a client can have skipped this one.
export function sentenceCase(text) {
  return String(text || '').replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
}
