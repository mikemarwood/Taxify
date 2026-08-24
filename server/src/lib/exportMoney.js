import { CURRENCIES } from './geoData.js';

// Money, written the way money is written.
//
// The PDF was printing raw toFixed(2): 3000.00 rather than $3,000.00. At four
// figures that is genuinely hard to read, and on a page of totals somebody is
// checking against their own records it is the difference between scanning and
// counting digits. The spreadsheet had thousands separators but no symbol, so a
// column of numbers gave no clue what they were denominated in — which matters
// here, because an account can be in any of eleven currencies.

const SYMBOLS = new Map(CURRENCIES.map((c) => [c.code, c.symbol]));

// The symbol for a currency code, falling back to the code itself. A prefix of
// "USD " is ugly but unambiguous, which is the right way round for money.
export function currencySymbol(code) {
  const upper = String(code || '').toUpperCase();
  return SYMBOLS.get(upper) || (upper ? `${upper} ` : '$');
}

// "$3,000.00". Grouped by hand rather than through Intl, because Intl's
// grouping and symbol placement follow the *locale* and this has to follow the
// account's currency — a British user with a pound account and an Australian
// server should see £, in the same layout, either way.
export function formatMoney(value, code) {
  // Checked before Number(), which turns null and '' into 0 — so a missing
  // amount would have printed as $0.00, which is a figure somebody might
  // believe rather than an obvious gap.
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const negative = number < 0;
  const [whole, fraction] = Math.abs(number).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${currencySymbol(code)}${grouped}.${fraction}`;
}

// The number format string Excel needs for the same thing.
//
// The symbol is quoted so Excel treats it as a literal rather than as part of
// a built-in currency format it might localise on opening. Negatives get a
// minus rather than the red brackets Excel likes, because a negative here is a
// correction, not a loss.
export function excelMoneyFormat(code) {
  const symbol = currencySymbol(code).replace(/"/g, '');
  return `"${symbol}"#,##0.00;-"${symbol}"#,##0.00`;
}
