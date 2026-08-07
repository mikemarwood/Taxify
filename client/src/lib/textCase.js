// Mirrors server/src/lib/textCase.js, the same way financialYear.js does — the
// server tidies text on the way in, and this tidies what is already stored on
// the way out, so rows written before either existed still read properly.
//
// The rule: fix a word that is clearly untidy — all lower or all upper — and
// leave alone one that carries deliberate capitals. Someone called McDonald
// should never see their own name spelled wrong.

function isUntidy(word) {
  const letters = word.replace(/[^a-zA-Z]/g, '');
  if (!letters) return false;
  return letters === letters.toLowerCase() || letters === letters.toUpperCase();
}

function capitaliseWord(word) {
  return (
    word
      .replace(/^([a-z])/, (_, ch) => ch.toUpperCase())
      .replace(/(-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
      // "O'Brien" yes, "McDonald's" no. A lone letter after an apostrophe is a
      // possessive, not the start of a name, so it needs a letter behind it
      // before it counts as one.
      .replace(/(['’])([a-z])(?=[a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
  );
}

export function titleCase(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.split(' ').map(tidyWord).join(' ');
}

function tidyWord(word) {
  if (!isUntidy(word)) return word;
  const letters = word.replace(/[^a-zA-Z]/g, '');
  // ATO, GST, NSW — an initialism, not shouting.
  if (letters.length <= 3 && letters === letters.toUpperCase() && letters.length > 1) return word;
  return capitaliseWord(word.toLowerCase());
}

// The same rule, with the spacing left exactly as typed.
//
// titleCase() trims and collapses runs of spaces, which is right for a value
// being submitted and wrong on every keystroke: run it on each change and the
// space someone just typed is removed before they can type the letter after
// it, so a name can never get a second word. Use this while typing, and
// titleCase() on the way out.
export function titleCaseLive(value) {
  const text = String(value ?? '');
  if (!text) return '';
  return text.split(' ').map(tidyWord).join(' ');
}

export function sentenceCase(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

export function lowerEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}
