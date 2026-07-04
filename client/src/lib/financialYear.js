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
