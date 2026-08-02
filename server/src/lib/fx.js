import pool from '../db.js';

// Converting a foreign expense into the currency the account keeps its books
// in.
//
// Two rules shape everything here:
//
//   1. The rate is the one for the *purchase date*, not today. For an expense
//      entered the day it happened those are the same number; for a receipt
//      typed up three months later they are not, and the ATO — like every
//      other revenue office — wants the rate at the time of the transaction.
//
//   2. If a rate cannot be established, the save is refused. Storing a number
//      we cannot justify is worse than making someone type one in, because a
//      wrong total looks exactly like a right one.

// European Central Bank reference rates, published daily, free, no API key and
// no rate limit. A weekend or a public holiday resolves to the most recent
// business day automatically, which is the behaviour we want.
const API = 'https://api.frankfurter.app';

// ECB does not publish these, and the account currency list includes them.
// Named rather than discovered at runtime so the message can say so.
export const UNSUPPORTED = new Set(['AED', 'FJD']);

const TIMEOUT_MS = 6000;

export function normaliseCode(code) {
  return String(code || '').trim().toUpperCase();
}

// Rounded to 2dp the way money is, and only ever from a finite rate.
export function convert(amount, rate) {
  const value = Number(amount) * Number(rate);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

async function readCache(date, base, quote) {
  const [rows] = await pool.execute(
    'SELECT rate FROM fx_rates WHERE rate_date = ? AND base = ? AND quote = ?',
    [date, base, quote]
  );
  return rows[0] ? Number(rows[0].rate) : null;
}

async function writeCache(date, base, quote, rate) {
  await pool.execute(
    `INSERT INTO fx_rates (rate_date, base, quote, rate) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rate = VALUES(rate), fetched_at = NOW()`,
    [date, base, quote, rate]
  );
}

// How many units of `quote` one unit of `from` was worth on `date`.
// Returns null rather than throwing or guessing — the caller decides what a
// missing rate means, and for us it means "ask the person".
export async function rateFor(from, quote, date) {
  const a = normaliseCode(from);
  const b = normaliseCode(quote);
  if (!a || !b) return null;
  if (a === b) return 1;
  if (UNSUPPORTED.has(a) || UNSUPPORTED.has(b)) return null;

  // A future date has no published rate; the latest one is the honest answer.
  const today = new Date().toISOString().slice(0, 10);
  const asked = String(date || today).slice(0, 10);
  const day = asked > today ? today : asked;

  const cached = await readCache(day, a, b);
  if (cached !== null) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${API}/${day}?from=${a}&to=${b}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json();
    const rate = Number(data?.rates?.[b]);
    if (!Number.isFinite(rate) || rate <= 0) return null;

    // Cached against the date asked for, not the date the ECB answered with —
    // asking for a Sunday should hit the cache next time too.
    await writeCache(day, a, b, rate);
    return rate;
  } catch (err) {
    // A network problem must never look like a successful conversion.
    console.error(`FX lookup failed for ${a}->${b} on ${day}`, err.message);
    return null;
  }
}

// Works out what to store for one expense. `manualRate` always wins: the
// person may be using the rate their own bank actually charged, which is more
// defensible than a reference rate and is theirs to assert.
//
// Returns { baseCurrency, baseAmount, rate, source, rateDate } or
// { error } when it cannot be done honestly.
export async function resolveBaseAmount({ amount, currency, baseCurrency, purchaseDate, manualRate }) {
  const from = normaliseCode(currency);
  const base = normaliseCode(baseCurrency) || 'AUD';
  const rateDate = String(purchaseDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

  if (from === base) {
    return { baseCurrency: base, baseAmount: convert(amount, 1), rate: 1, source: 'same', rateDate };
  }

  if (manualRate !== undefined && manualRate !== null && manualRate !== '') {
    const rate = Number(manualRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return { error: 'Enter the exchange rate as a positive number' };
    }
    return { baseCurrency: base, baseAmount: convert(amount, rate), rate, source: 'manual', rateDate };
  }

  const rate = await rateFor(from, base, rateDate);
  if (rate === null) {
    return {
      error:
        UNSUPPORTED.has(from) || UNSUPPORTED.has(base)
          ? `We can't look up ${from} to ${base} rates — enter the rate you used and we'll save that.`
          : `We couldn't fetch the ${from} to ${base} rate for ${rateDate}. Enter the rate you used and we'll save that.`,
      needsRate: true,
    };
  }

  return { baseCurrency: base, baseAmount: convert(amount, rate), rate, source: 'live', rateDate };
}
