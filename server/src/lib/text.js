export function toTitleCase(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
