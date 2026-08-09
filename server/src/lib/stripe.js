import Stripe from 'stripe';
import { getSetting, setSetting } from '../db.js';

const SETTING_KEYS = {
  mode: 'stripe_mode',
  live: {
    publishableKey: 'stripe_live_publishable_key',
    secretKey: 'stripe_live_secret_key',
    webhookSecret: 'stripe_live_webhook_secret',
    priceIndividual: 'stripe_live_price_individual',
    priceBusiness: 'stripe_live_price_business',
    // The Small Business plan was the Family plan, and it is the same product
    // at the same price — so an account with nothing in the new key keeps
    // billing from the old one and nobody has to touch Stripe.
    priceFamily: 'stripe_live_price_family',
  },
  test: {
    publishableKey: 'stripe_test_publishable_key',
    secretKey: 'stripe_test_secret_key',
    webhookSecret: 'stripe_test_webhook_secret',
    priceIndividual: 'stripe_test_price_individual',
    priceBusiness: 'stripe_test_price_business',
    priceFamily: 'stripe_test_price_family',
  },
};

// Legacy single-key settings from before live/test modes existed.
const LEGACY_KEYS = {
  publishableKey: 'stripe_publishable_key',
  secretKey: 'stripe_secret_key',
  webhookSecret: 'stripe_webhook_secret',
};

let stripeClient = null;
let stripeClientKey = null;

async function getModeConfig(mode) {
  const keys = SETTING_KEYS[mode];
  const [publishableKey, secretKey, webhookSecret, priceIndividual, priceBusiness, priceFamily] = await Promise.all([
    getSetting(keys.publishableKey),
    getSetting(keys.secretKey),
    getSetting(keys.webhookSecret),
    getSetting(keys.priceIndividual),
    getSetting(keys.priceBusiness),
    getSetting(keys.priceFamily),
  ]);

  if (mode === 'live' && !publishableKey && !secretKey && !webhookSecret) {
    // Fall back to the pre-test-mode legacy settings if live hasn't been saved yet.
    const [legacyPub, legacySecret, legacyWebhook] = await Promise.all([
      getSetting(LEGACY_KEYS.publishableKey),
      getSetting(LEGACY_KEYS.secretKey),
      getSetting(LEGACY_KEYS.webhookSecret),
    ]);
    return {
      publishableKey: legacyPub || process.env.STRIPE_PUBLISHABLE_KEY || '',
      secretKey: legacySecret || process.env.STRIPE_SECRET_KEY || '',
      webhookSecret: legacyWebhook || process.env.STRIPE_WEBHOOK_SECRET || '',
      priceIndividual: priceIndividual || process.env.STRIPE_PRICE_ID_INDIVIDUAL || '',
      priceBusiness: priceBusiness || process.env.STRIPE_PRICE_ID_BUSINESS || '',
      priceFamily: priceFamily || process.env.STRIPE_PRICE_ID_FAMILY || '',
    };
  }

  if (mode === 'live') {
    return {
      publishableKey: publishableKey || process.env.STRIPE_PUBLISHABLE_KEY || '',
      secretKey: secretKey || process.env.STRIPE_SECRET_KEY || '',
      webhookSecret: webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '',
      priceIndividual: priceIndividual || process.env.STRIPE_PRICE_ID_INDIVIDUAL || '',
      priceBusiness: priceBusiness || process.env.STRIPE_PRICE_ID_BUSINESS || '',
      priceFamily: priceFamily || process.env.STRIPE_PRICE_ID_FAMILY || '',
    };
  }

  return {
    publishableKey: publishableKey || '',
    secretKey: secretKey || '',
    webhookSecret: webhookSecret || '',
    priceIndividual: priceIndividual || process.env.STRIPE_PRICE_ID_INDIVIDUAL_TEST || '',
    priceBusiness: priceBusiness || process.env.STRIPE_PRICE_ID_BUSINESS_TEST || '',
    priceFamily: priceFamily || process.env.STRIPE_PRICE_ID_FAMILY_TEST || '',
  };
}

export async function getStripeMode() {
  const mode = await getSetting(SETTING_KEYS.mode);
  return mode === 'test' ? 'test' : 'live';
}

// Resolved config for whichever mode (live/test) is currently active.
export async function getStripeConfig() {
  const mode = await getStripeMode();
  const config = await getModeConfig(mode);
  return { mode, ...config };
}

export async function getStripeSecretKeyForMode(mode) {
  const config = await getModeConfig(mode === 'test' ? 'test' : 'live');
  return config.secretKey;
}

// Full settings for both modes, for the admin UI. Secret keys are reduced to a boolean.
export async function getStripeAdminSettings() {
  const mode = await getStripeMode();
  const [live, test] = await Promise.all([getModeConfig('live'), getModeConfig('test')]);
  return {
    mode,
    live: { ...live, hasSecretKey: !!live.secretKey, secretKey: undefined },
    test: { ...test, hasSecretKey: !!test.secretKey, secretKey: undefined },
  };
}

export async function saveStripeAdminSettings({ mode, live, test }) {
  if (mode !== undefined) {
    if (mode !== 'live' && mode !== 'test') throw new Error('mode must be "live" or "test"');
    await setSetting(SETTING_KEYS.mode, mode);
  }
  for (const [section, values] of [['live', live], ['test', test]]) {
    if (!values) continue;
    const keys = SETTING_KEYS[section];
    if (values.publishableKey !== undefined) await setSetting(keys.publishableKey, values.publishableKey);
    if (values.secretKey) await setSetting(keys.secretKey, values.secretKey);
    if (values.webhookSecret !== undefined) await setSetting(keys.webhookSecret, values.webhookSecret);
    if (values.priceIndividual !== undefined) await setSetting(keys.priceIndividual, values.priceIndividual);
    if (values.priceBusiness !== undefined) await setSetting(keys.priceBusiness, values.priceBusiness);
    if (values.priceFamily !== undefined) await setSetting(keys.priceFamily, values.priceFamily);
  }
  stripeClient = null;
  stripeClientKey = null;
}

export async function getStripe() {
  const { secretKey, mode } = await getStripeConfig();
  if (!secretKey) {
    throw new Error(`Stripe is not configured for ${mode} mode — set it up in Admin > Stripe`);
  }
  if (!stripeClient || stripeClientKey !== secretKey) {
    stripeClient = new Stripe(secretKey);
    stripeClientKey = secretKey;
  }
  return stripeClient;
}

export async function priceIdForPlan(planType) {
  const { priceIndividual, priceBusiness, priceFamily, mode } = await getStripeConfig();
  // 'family' is still accepted so a row that has not been renamed yet still
  // bills, and the old price setting stands in until somebody fills the new one.
  const id = planType === 'business' || planType === 'family' ? priceBusiness || priceFamily : priceIndividual;
  if (!id) {
    throw new Error(`Stripe price id is not configured for the ${planType} plan (${mode} mode)`);
  }
  return id;
}

// Plan cards on the sign-up page. Prices come from Stripe rather than being
// typed into the client, so what someone is quoted is what they'll be charged
// and changing a price in Stripe is enough.
//
// Yearly only: the app is sold as an annual product and showing a monthly
// figure people can't actually buy is a bait. A price configured with a
// different interval is normalised to what a year of it costs.
// The only thing that differs between these is how many sets of books the
// account may hold. Everything else — reports, exports, receipts, accountant
// access — is on both, and listing a shared feature under one plan reads as an
// upsell that isn't real, which someone finds out only after paying.
// Every event the webhook acts on.
//
// An endpoint missing one of these fails silently: Stripe reports the delivery
// as successful because it never sent it, and the app simply never learns what
// happened. checkout.session.completed going missing is what left somebody who
// had paid to renew locked out of their own account, holding a receipt.
export const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

const PLAN_COPY = {
  individual: {
    name: 'Individual',
    tagline: 'Every deduction you are owed, kept as you go.',
    features: [
      'Photograph a receipt and it files itself',
      'Unlimited expenses and receipts — nothing is ever archived away',
      'Every year side by side, exported in one click',
      'Give your accountant read-only access, and take it back when you like',
      'Your records stay yours if you ever stop paying',
    ],
  },
  business: {
    name: 'Small Business',
    tagline: 'Your own return and up to two businesses, never mixed up.',
    features: [
      'Everything in Individual, for your personal return',
      'Up to two businesses, each with books of their own',
      'Separate totals and reports for each — no untangling at tax time',
      'Give your accountant read-only access, and take it back when you like',
      'Your records stay yours if you ever stop paying',
    ],
  },
};

function yearlyAmount(price) {
  const amount = price.unit_amount ?? 0;
  const interval = price.recurring?.interval;
  const count = price.recurring?.interval_count || 1;
  if (interval === 'year') return amount / count;
  if (interval === 'month') return (amount * 12) / count;
  if (interval === 'week') return (amount * 52) / count;
  if (interval === 'day') return (amount * 365) / count;
  return amount;
}

export async function getSignupPlans() {
  const config = await getStripeConfig();
  // The old Family price stands in until the Business one is set, so the cards
  // keep showing a real figure through the rename.
  const ids = {
    individual: config.priceIndividual,
    business: config.priceBusiness || config.priceFamily,
  };

  let stripe = null;
  try {
    stripe = await getStripe();
  } catch {
    // Not configured yet — the cards still render, just without a price.
  }

  const plans = [];
  for (const planType of ['individual', 'business']) {
    const copy = PLAN_COPY[planType];
    const priceId = ids[planType];
    let amount = null;
    let currency = null;

    if (stripe && priceId) {
      try {
        const price = await stripe.prices.retrieve(priceId);
        amount = Math.round(yearlyAmount(price));
        currency = String(price.currency || '').toUpperCase();
      } catch (err) {
        console.error(`Could not read the ${planType} price from Stripe`, err.message);
      }
    }

    plans.push({ planType, ...copy, priceId: priceId || null, amountPerYear: amount, currency });
  }
  return plans;
}

// The inverse of priceIdForPlan.
//
// Needed because a plan can change without us being asked: the Stripe billing
// portal lets a customer move between plans directly, and the only thing that
// arrives afterwards is a subscription webhook carrying a price id. Without
// this the webhook updated the status and left plan_type alone, so somebody
// could pay for one plan and keep the entitlement of the other.
//
// Returns null for a price we do not recognise — an old one, or a mode
// mismatch. The caller leaves plan_type as it was rather than guessing, since
// guessing wrong either bills for what they cannot use or gives away what they
// have not bought.
export async function planTypeForPriceId(priceId) {
  if (!priceId) return null;
  const { priceIndividual, priceBusiness, priceFamily } = await getStripeConfig();
  if (priceId === priceIndividual) return 'individual';
  if (priceId === priceBusiness || priceId === priceFamily) return 'business';
  return null;
}
