import Stripe from 'stripe';
import { getSetting, setSetting } from '../db.js';

const SETTING_KEYS = {
  mode: 'stripe_mode',
  live: {
    publishableKey: 'stripe_live_publishable_key',
    secretKey: 'stripe_live_secret_key',
    webhookSecret: 'stripe_live_webhook_secret',
    priceIndividual: 'stripe_live_price_individual',
    priceFamily: 'stripe_live_price_family',
  },
  test: {
    publishableKey: 'stripe_test_publishable_key',
    secretKey: 'stripe_test_secret_key',
    webhookSecret: 'stripe_test_webhook_secret',
    priceIndividual: 'stripe_test_price_individual',
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
  const [publishableKey, secretKey, webhookSecret, priceIndividual, priceFamily] = await Promise.all([
    getSetting(keys.publishableKey),
    getSetting(keys.secretKey),
    getSetting(keys.webhookSecret),
    getSetting(keys.priceIndividual),
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
      priceFamily: priceFamily || process.env.STRIPE_PRICE_ID_FAMILY || '',
    };
  }

  if (mode === 'live') {
    return {
      publishableKey: publishableKey || process.env.STRIPE_PUBLISHABLE_KEY || '',
      secretKey: secretKey || process.env.STRIPE_SECRET_KEY || '',
      webhookSecret: webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '',
      priceIndividual: priceIndividual || process.env.STRIPE_PRICE_ID_INDIVIDUAL || '',
      priceFamily: priceFamily || process.env.STRIPE_PRICE_ID_FAMILY || '',
    };
  }

  return {
    publishableKey: publishableKey || '',
    secretKey: secretKey || '',
    webhookSecret: webhookSecret || '',
    priceIndividual: priceIndividual || process.env.STRIPE_PRICE_ID_INDIVIDUAL_TEST || '',
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
  const { priceIndividual, priceFamily, mode } = await getStripeConfig();
  const id = planType === 'family' ? priceFamily : priceIndividual;
  if (!id) {
    throw new Error(`Stripe price id is not configured for the ${planType} plan (${mode} mode)`);
  }
  return id;
}
