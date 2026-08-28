// The currencies an expense can be recorded in.
//
// Mirrored from server/src/lib/geoData.js, which is the list the account's own
// currency is chosen from at sign-up. The two expense forms each carried their
// own five — AUD, USD, NZD, GBP, EUR — so somebody who signed up in Canada or
// Singapore had an account currency the expense form could not offer, and
// their own money was not on the list of things they could spend.
//
// Codes only would be shorter, but a dropdown reading "SGD" against "HKD"
// against "SEK" is a memory test. The name is what makes it a choice.
export const CURRENCIES = [
  { code: 'AUD', name: 'Australian Dollar', symbol: '$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: '$' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: '$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: '$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
  { code: 'FJD', name: 'Fijian Dollar', symbol: '$' },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

// The account's own currency first, then the rest.
//
// Almost every expense is in the currency the account is kept in, and hunting
// for it in an alphabetical list of twenty-nine is a small tax on the common
// case. An unknown code is still put at the top rather than dropped: the value
// stored on an existing expense has to remain selectable, or opening an old
// record would silently change what it says.
export function currenciesFor(preferred) {
  const code = String(preferred || '').toUpperCase();
  if (!code) return CURRENCIES;
  const known = CURRENCIES.find((c) => c.code === code);
  const rest = CURRENCIES.filter((c) => c.code !== code);
  return [known || { code, name: code, symbol: '' }, ...rest];
}
