export function financialYearOf(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

export function currentFinancialYear() {
  return financialYearOf(new Date().toISOString());
}

// Which financial year a page should land on. Defaulting blindly to the
// current one hides everything when the only data is historical — and worse,
// a <select> whose value matches no <option> renders as the first option, so
// the filter silently disagrees with what the dropdown appears to say.
export function defaultFinancialYear(expenses) {
  const current = currentFinancialYear();
  if (!expenses || expenses.length === 0) return current;

  const available = new Set(expenses.map((e) => e.financialYear));
  if (available.has(current)) return current;

  // Most recent year that actually has expenses.
  return Array.from(available).sort().reverse()[0] || current;
}
