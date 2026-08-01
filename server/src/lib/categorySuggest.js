// Guessing the category from what someone types, learned from what they have
// actually filed before.
//
// The old behaviour was an exact-string match kept in the browser: type
// "Bunnings" twice identically and it remembered, type "Bunnings Warehouse
// Hornsby" and it had never heard of you. This works on words instead, scores
// them against the account's real history, and lives on the server so it
// follows you between devices and knows about expenses added on your phone.

// Words that appear in everything and therefore separate nothing.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'this', 'that', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by',
  'pty', 'ltd', 'inc', 'llc', 'co', 'au', 'com', 'store', 'shop', 'purchase', 'payment', 'invoice',
  'receipt', 'order', 'new', 'monthly', 'annual', 'subscription',
]);

export function tokenise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

// `history` is [{ itemName, categoryName, count, lastUsed }] — one row per
// distinct thing they have bought and where they filed it.
export function suggestCategory(itemName, history, { now = Date.now() } = {}) {
  const query = new Set(tokenise(itemName));
  if (query.size === 0 || !history?.length) return null;

  // A word used across many different past items says little about which
  // category this is; a word that only ever appears in one says a lot. This is
  // the same idea as idf, kept deliberately crude.
  const docFrequency = new Map();
  const tokenised = history.map((row) => {
    const tokens = new Set(tokenise(row.itemName));
    for (const t of tokens) docFrequency.set(t, (docFrequency.get(t) || 0) + 1);
    return { ...row, tokens };
  });

  const scores = new Map();
  let best = null;

  for (const row of tokenised) {
    if (!row.categoryName) continue;

    let overlap = 0;
    let weight = 0;
    for (const token of query) {
      if (!row.tokens.has(token)) continue;
      overlap += 1;
      weight += 1 / Math.log2(2 + (docFrequency.get(token) || 1));
    }
    if (overlap === 0) continue;

    // How much of what they typed this past entry explains, and how much of
    // the past entry the typing explains — both matter. "Coffee" should not
    // strongly match "Coffee Machine Repair Service Call".
    const coverage = overlap / query.size;
    const precision = overlap / row.tokens.size;

    // Something bought twenty times is a stronger signal than something bought
    // once, but not twenty times stronger.
    const repetition = 1 + Math.log10(1 + Number(row.count || 1));

    // A year-old habit still counts, just less than last month's.
    const ageDays = row.lastUsed ? Math.max(0, (now - new Date(row.lastUsed).getTime()) / 86400000) : 365;
    const recency = 1 / (1 + ageDays / 540);

    const score = (coverage * 2 + precision) * weight * repetition * recency;

    const running = (scores.get(row.categoryName) || 0) + score;
    scores.set(row.categoryName, running);

    if (!best || score > best.score) {
      best = { score, categoryName: row.categoryName, example: row.itemName, count: Number(row.count || 1) };
    }
  }

  if (!best) return null;

  // The winner is the category with the most accumulated evidence, which is
  // not always the category of the single closest match.
  let topCategory = null;
  let topScore = 0;
  let runnerUp = 0;
  for (const [name, score] of scores) {
    if (score > topScore) {
      runnerUp = topScore;
      topScore = score;
      topCategory = name;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // Only offer it when it is actually ahead. A guess that is barely in front
  // of a different answer is worse than no guess, because it gets accepted
  // without being read.
  const margin = runnerUp > 0 ? topScore / runnerUp : Infinity;
  if (topScore < 0.35 || margin < 1.25) return null;

  return {
    categoryName: topCategory,
    // The example is only shown when it belongs to the category being
    // suggested — otherwise it explains the wrong thing.
    example: best.categoryName === topCategory ? best.example : null,
    timesUsed: best.categoryName === topCategory ? best.count : null,
    confidence: margin >= 3 ? 'high' : margin >= 1.8 ? 'medium' : 'low',
  };
}
