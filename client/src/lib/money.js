// Grouped to thousands everywhere an amount is shown: $10,000.00 is read at a
// glance, $10000.00 has to be counted. Uses Intl so the separator follows the
// browser's locale rather than being hardcoded to a comma.
const grouped = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// The currency the account keeps its books in. Published once when the user
// loads, for the same reason the date locale is: money is shown in dozens of
// places that have no business knowing about the user.
let baseCurrency = 'AUD';

export function setBaseCurrency(code) {
  if (code) baseCurrency = String(code).toUpperCase();
}

// "1,234.50" — no symbol, for places that draw their own.
export function formatAmount(value) {
  const n = Number(value);
  return grouped.format(Number.isFinite(n) ? n : 0);
}

// The symbol a currency is actually written with.
//
// Intl defaults to currencyDisplay: 'symbol', which is not the symbol — it is
// whatever the locale needs to be unambiguous. In en-AU that turns USD into
// "USD 1,234.50" and EUR into "EUR 1,234.50", because a reader in Australia
// would otherwise take a bare $ for their own money. Correct, and not what was
// asked for on a screen that names the currency underneath the figure anyway.
//
// 'narrowSymbol' gives $, £, €, kr, ¥. It is a newer option and older Safari
// throws RangeError on it rather than ignoring it, so the fall-through repeats
// the format with the default rather than losing the amount entirely.
function currencyFormatter(code) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

// "$1,234.50", "€1,234.50", "£1,234.50". The symbol used to be a hard-coded
// dollar sign, which quietly mislabelled every foreign amount in the app.
export function formatMoney(value, currency) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  const code = String(currency || baseCurrency).toUpperCase();
  try {
    return currencyFormatter(code).format(safe);
  } catch {
    // An unknown code should still print a number rather than throwing.
    return `${code} ${grouped.format(safe)}`;
  }
}

// What an expense contributes to a total: the amount converted into the
// account's own currency, then apportioned by how much of it was business use.
// A laptop bought for $2,000 and used 60% for work contributes $1,200 — the
// receipt still says $2,000, and both figures matter.
//
// Null baseAmount means it could not be converted honestly, and such a row is
// excluded rather than counted at face value — see `unconvertedCount` for how
// that is reported instead of hidden.
export function claimable(expense) {
  const value = expense?.baseAmount;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const pct = Number(expense?.businessUsePct);
  const share = Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : 100;
  return Math.round(value * (share / 100) * 100) / 100;
}

// The full amount before apportionment, in the account's currency. Shown
// beside the claim so the two are never confused for one another.
export function fullAmount(expense) {
  const value = expense?.baseAmount;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function isApportioned(expense) {
  const pct = Number(expense?.businessUsePct);
  return Number.isFinite(pct) && pct > 0 && pct < 100;
}

// Rows that are in a foreign currency and have no conversion. Shown as a
// warning wherever a total is, because a total quietly missing three expenses
// is worse than one that says so.
export function unconvertedCount(expenses) {
  return (expenses || []).filter((e) => e && e.baseAmount === null).length;
}

// True when this expense was entered in something other than the account's
// currency, and so has an original worth showing alongside the converted one.
export function isForeign(expense) {
  return !!expense?.baseCurrency && !!expense?.currency && expense.currency !== expense.baseCurrency;
}

// What an amount field accepts while somebody is typing.
//
// Digits, one decimal point, and at most two places after it — so 32.239 can
// never be typed, rather than being accepted and silently rounded to something
// the person did not write. Kept permissive otherwise: an empty box and a bare
// "." are both valid mid-typing states and must not be fought.
export function amountWhileTyping(raw) {
  // Commas are stripped rather than refused: the field shows them after a blur,
  // so anything typed into an already-formatted value has to survive being
  // edited in place.
  let text = String(raw ?? '').replace(/[^\d.]/g, '');

  // Only the first point survives. Typing a second one is a slip, not a request
  // for a second decimal separator.
  const first = text.indexOf('.');
  if (first !== -1) {
    text = text.slice(0, first + 1) + text.slice(first + 1).replace(/\./g, '');
  }

  const [whole, decimals] = text.split('.');
  if (decimals === undefined) return whole;
  return `${whole}.${decimals.slice(0, 2)}`;
}

// What it settles to when the field is left. "32.2" becomes "32.20" and "32."
// becomes "32.00", so what is stored is what is shown. An empty field stays
// empty — filling it with 0.00 would put a number somebody never entered in
// front of them.
export function amountOnBlur(raw) {
  const value = parseAmount(raw);
  if (value === null) return '';
  return formatAmountInput(value);
}

// The number behind what is displayed. Every amount field shows a grouped
// string, so anything sending one to the server has to come back through here
// first — Number("3,350.00") is NaN, and a form that quietly posts NaN is worse
// than one that refuses.
export function parseAmount(raw) {
  const text = String(raw ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// 3350 becomes "3,350.00".
//
// Grouping is applied when the field is left, never while typing. Adding a
// separator mid-number changes the length of the text, and a controlled input
// whose length changes under the cursor sends the caret to the end — so
// somebody correcting the third digit of a long number would be thrown to the
// far end of it on every keystroke. Two decimal places always, because a
// trailing "50" that might be five cents or fifty is not a saving worth making.
export function formatAmountInput(value) {
  const number = typeof value === 'number' ? value : parseAmount(value);
  if (number === null || !Number.isFinite(number)) return '';
  const [whole, decimals] = number.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimals}`;
}

// The symbol for a currency, on its own — "$", "£", "€".
//
// Taken from Intl rather than a table so it is right for every code the account
// list offers, and so AUD and USD both come out as "$" the way somebody in
// either country expects to see it. The code sits beside the field for the
// cases where that matters.
export function currencySymbol(code) {
  const currency = String(code || baseCurrency).toUpperCase();
  try {
    // Same narrow symbol as formatMoney, so the prefix inside the amount box
    // and the figure it produces cannot disagree about what a currency looks
    // like. Without it this returned the three-letter code for everything
    // except the account's own money.
    const parts = currencyFormatter(currency).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || currency;
  } catch {
    return currency;
  }
}
