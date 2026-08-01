// Australian financial year runs 1 Jul - 30 Jun. Returns e.g. "2025-2026" for
// any date between 2025-07-01 and 2026-06-30.
export function financialYearOf(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-based, June = 5
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

// The financial year today falls in. "This year" through the second half of a
// calendar year is the one that has just started, not the one that just ended.
export function defaultFinancialYear() {
  return financialYearOf(new Date().toISOString().slice(0, 10));
}

// The inverse, for turning a "2024-2025" folder name back into the dates it
// covers — needed when a rename has to find the expenses filed under it.
// Returns null for anything that isn't one of our year folders.
export function financialYearRange(label) {
  const match = /^(\d{4})-(\d{4})$/.exec(String(label || ''));
  if (!match) return null;
  const startYear = Number(match[1]);
  if (Number(match[2]) !== startYear + 1) return null;
  return { start: `${startYear}-07-01`, end: `${startYear + 1}-06-30` };
}
