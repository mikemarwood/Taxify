// Movement against the period before, for the tiles at the top of the
// dashboard.
//
// The rule that matters is the one about nothing to compare against. A first
// month, or a first financial year, has no previous period — and a tile that
// answers that with "+100%", or with a green arrow, is inventing a trend out of
// a single data point. It says nothing instead, which is both true and quieter.
//
// Deliberately the same arithmetic and the same null as changeBetween in
// server/src/lib/analytics.js, so the dashboard and the admin traffic panel
// cannot disagree about what a percentage means.

export function changeBetween(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

// "+12%" / "−8%" / "0%". A true minus sign rather than a hyphen, because these
// sit next to an arrow at 12px and a hyphen reads as a dash.
export function formatChange(percent) {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

// Which way it went, for the colour and the arrow. Zero is neither.
export function directionOf(percent) {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  if (rounded === 0) return 'flat';
  return rounded > 0 ? 'up' : 'down';
}
