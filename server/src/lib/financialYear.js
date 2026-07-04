// Australian financial year runs 1 Jul - 30 Jun. Returns e.g. "2025-2026" for
// any date between 2025-07-01 and 2026-06-30.
export function financialYearOf(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-based, June = 5
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}
