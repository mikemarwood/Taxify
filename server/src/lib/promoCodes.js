import pool from '../db.js';

// Promo codes are always upper case. People type them off an email or a flyer
// in whatever case they like, so normalising on the way in and on the way out
// means "spring25" and "SPRING25" are the same code rather than two.
export function normalisePromoCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

export function isValidPromoCodeFormat(code) {
  return PROMO_CODE_PATTERN.test(code);
}

// Returns { ok: true, promo, discount } or { ok: false, reason } — the reason
// is written to be shown to whoever typed the code, so it says which of the
// several ways a code can be unusable actually applies.
export async function evaluatePromoCode(rawCode, planType, amountPerYear) {
  const code = normalisePromoCode(rawCode);
  if (!code) return { ok: false, reason: 'Enter a promo code' };
  // Deliberately the same wording as a code that simply is not in the table.
  // Telling somebody their code has the wrong characters in it explains our
  // validation rather than their problem, and either way the answer is that
  // this code will not work.
  if (!isValidPromoCodeFormat(code)) return { ok: false, reason: 'Invalid promo code' };

  const [rows] = await pool.execute('SELECT * FROM promo_codes WHERE code = ?', [code]);
  const promo = rows[0];
  if (!promo) return { ok: false, reason: 'Invalid promo code' };
  if (!promo.active) return { ok: false, reason: 'That code is no longer active' };
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return { ok: false, reason: 'That code has expired' };
  }
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
    return { ok: false, reason: 'That code has been fully redeemed' };
  }
  if (promo.plan_type && promo.plan_type !== planType) {
    return { ok: false, reason: `That code only applies to the ${promo.plan_type} plan` };
  }

  return { ok: true, promo: toPublicPromo(promo), discount: applyDiscount(promo, amountPerYear) };
}

// Amounts are in cents, matching Stripe. Percentages round to the nearest cent
// and nothing can take a price below zero.
export function applyDiscount(promo, amountPerYear) {
  if (amountPerYear === null || amountPerYear === undefined) return null;
  let total = Number(amountPerYear);

  if (promo.percent_off) total -= Math.round((total * Number(promo.percent_off)) / 100);
  if (promo.amount_off) total -= Math.round(Number(promo.amount_off) * 100);

  return Math.max(0, Math.round(total));
}

// The Stripe coupon for a promo code, made once and reused.
//
// duration: 'once' is the whole point. A Stripe coupon defaults to 'forever',
// which would take the discount off every renewal for as long as somebody stays
// subscribed — a code meant to bring one customer in would quietly cost the
// difference every year after. 'once' applies it to the first invoice and no
// other.
export async function stripeCouponFor(stripe, promo) {
  if (promo.stripe_coupon_id) {
    try {
      const existing = await stripe.coupons.retrieve(promo.stripe_coupon_id);
      // A coupon deleted in the dashboard comes back marked, and reusing it
      // fails the checkout rather than merely not discounting.
      if (existing && !existing.deleted) return existing.id;
    } catch {
      // Gone from Stripe entirely. Fall through and make another.
    }
  }

  const coupon = await stripe.coupons.create({
    name: `Taxify ${promo.code}`,
    duration: 'once',
    ...(promo.percent_off
      ? { percent_off: Number(promo.percent_off) }
      : { amount_off: Math.round(Number(promo.amount_off) * 100), currency: 'aud' }),
    metadata: { promoCode: promo.code },
  });

  await pool.execute('UPDATE promo_codes SET stripe_coupon_id = ? WHERE id = ?', [coupon.id, promo.id]);
  return coupon.id;
}

// The code somebody registered with, if it is still worth honouring. Read at
// checkout rather than at registration, because that is the moment money
// changes hands and a code can lapse in between.
export async function pendingPromoFor(userId, planType) {
  const [rows] = await pool.execute(
    'SELECT promo_code, promo_redeemed_at FROM users WHERE id = ?',
    [userId]
  );
  const user = rows[0];
  // Once only, per account. Without this the same code would discount a second
  // subscription after somebody cancelled and came back.
  if (!user?.promo_code || user.promo_redeemed_at) return null;

  const [promos] = await pool.execute('SELECT * FROM promo_codes WHERE code = ?', [user.promo_code]);
  const promo = promos[0];
  if (!promo || !promo.active) return null;
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) return null;
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) return null;
  if (promo.plan_type && promo.plan_type !== planType) return null;

  return promo;
}

export function toPublicPromo(promo) {
  return {
    code: promo.code,
    description: promo.description,
    planType: promo.plan_type,
    percentOff: promo.percent_off === null ? null : Number(promo.percent_off),
    amountOff: promo.amount_off === null ? null : Number(promo.amount_off),
    trialDays: promo.trial_days,
  };
}

// Called once the account it was used on actually exists. Deliberately not
// transactional with the insert: over-counting a redemption is a far smaller
// problem than refusing a sign-up because the counter row was locked.
export async function recordPromoRedemption(code) {
  if (!code) return;
  await pool.execute('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?', [code]);
}
