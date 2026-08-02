// Coerced rather than assumed. Every call site currently passes a string, but
// this feeds a folder name that then gets renamed on disk, and a TypeError
// there would fail a category rename halfway through.
export function toTitleCase(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
