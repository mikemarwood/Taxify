import Stripe from 'stripe';

let stripeClient = null;

export function getStripe() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export function priceIdForPlan(planType) {
  const id = planType === 'family' ? process.env.STRIPE_PRICE_ID_FAMILY : process.env.STRIPE_PRICE_ID_INDIVIDUAL;
  if (!id) {
    throw new Error(`Stripe price id is not configured for the ${planType} plan`);
  }
  return id;
}
