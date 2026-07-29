// Grouped to thousands everywhere an amount is shown: $10,000.00 is read at a
// glance, $10000.00 has to be counted. Uses Intl so the separator follows the
// browser's locale rather than being hardcoded to a comma.
const grouped = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// "1,234.50" — no symbol, for places that draw their own.
export function formatAmount(value) {
  const n = Number(value);
  return grouped.format(Number.isFinite(n) ? n : 0);
}

// "$1,234.50"
export function formatMoney(value) {
  return `$${formatAmount(value)}`;
}
