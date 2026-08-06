import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireAccountOwner } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getStripe, getStripeConfig, priceIdForPlan } from '../lib/stripe.js';

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const router = Router();

router.post(
  '/checkout',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const stripe = await getStripe();

    // The plan can be chosen at checkout, so someone whose trial has ended can
    // subscribe to the plan they actually want rather than the one their trial
    // happened to start on. Anything unrecognised falls back to their current
    // plan — the price charged is always one of ours, never client-supplied.
    const requested =
      req.body?.planType === 'business' ? 'business' : req.body?.planType === 'individual' ? 'individual' : null;
    const planType = requested || req.user.planType || 'individual';

    // A guard used to sit here refusing a downgrade while a second login
    // existed. It queried `account_owner_id`, a column that has never existed —
    // so rather than refusing, it threw: every customer whose trial had ended
    // and who clicked the Individual card got a 500 instead of a checkout.
    // Precisely the person being asked to pay.
    //
    // There are no second logins now, so it is gone rather than corrected. What
    // a downgrade genuinely has to consider is the business books it leaves
    // them over the limit of, and that is handled where it belongs — on
    // creating a set of books — so nothing is ever deleted because a plan
    // changed.

    const priceId = await priceIdForPlan(planType);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: req.user.stripeCustomerId || undefined,
      customer_email: req.user.stripeCustomerId ? undefined : req.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(req.user.id),
      metadata: { userId: String(req.user.id), planType },
      success_url: `${CLIENT_ORIGIN}/account?checkout=success`,
      cancel_url: `${CLIENT_ORIGIN}/account?checkout=cancelled`,
    });

    res.json({ url: session.url });
  })
);

// Moving between plans on a *live* subscription. Sending an existing
// subscriber back through checkout would open a second subscription and bill
// them twice, so the price on the one they have is swapped instead and Stripe
// prorates the difference.
router.post(
  '/change-plan',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const planType = req.body?.planType === 'business' ? 'business' : 'individual';

    // Downgrading while a second person is still using the account would lock
    // them out, so it is refused rather than quietly stranding someone.
    if (planType === 'individual') {
      const [members] = await pool.execute(
        `SELECT COUNT(*) AS n FROM users WHERE account_holder_id = ? AND role = 'sub_user'`,
        [req.user.id]
      );
      if (Number(members[0]?.n) > 0) {
        return res
          .status(400)
          .json({ error: 'Remove the second full-access login before moving to the Individual plan.' });
      }
    }

    const [rows] = await pool.execute(
      'SELECT stripe_subscription_id, plan_type FROM users WHERE id = ?',
      [req.user.id]
    );
    const subscriptionId = rows[0]?.stripe_subscription_id;

    // Nothing live to change — they should go through checkout instead.
    if (!subscriptionId || req.user.subscriptionStatus !== 'active') {
      return res.status(409).json({ error: 'no_subscription' });
    }
    if (rows[0].plan_type === planType) {
      return res.status(400).json({ error: `You are already on the ${planType} plan` });
    }

    const stripe = await getStripe();
    const priceId = await priceIdForPlan(planType);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items?.data?.[0]?.id;
    if (!itemId) return res.status(409).json({ error: 'no_subscription' });

    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'create_prorations',
    });

    await pool.execute('UPDATE users SET plan_type = ? WHERE id = ?', [planType, req.user.id]);
    res.json({ ok: true, planType });
  })
);

router.post(
  '/portal',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT stripe_customer_id FROM users WHERE id = ?', [req.user.id]);
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No billing account yet — subscribe first' });

    const stripe = await getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${CLIENT_ORIGIN}/account`,
    });

    res.json({ url: session.url });
  })
);

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const stripe = await getStripe();
    const { webhookSecret } = await getStripeConfig();
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
    } catch (err) {
      console.error('Stripe webhook signature verification failed', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = Number(session.client_reference_id || session.metadata?.userId);
        if (userId) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          // They may have switched plan at checkout, so the plan recorded here
          // is the one that was actually paid for.
          const planType = session.metadata?.planType === 'business' ? 'business' : 'individual';
          await pool.execute(
            `UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = 'active',
             plan_type = ?, subscription_current_period_end = FROM_UNIXTIME(?) WHERE id = ?`,
            [session.customer, subscription.id, planType, subscription.current_period_end, userId]
          );
        }
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const statusMap = {
          active: 'active',
          trialing: 'active',
          past_due: 'past_due',
          canceled: 'canceled',
          unpaid: 'past_due',
        };
        const status = statusMap[subscription.status] || 'expired';
        await pool.execute(
          `UPDATE users SET subscription_status = ?, subscription_current_period_end = FROM_UNIXTIME(?) WHERE stripe_customer_id = ?`,
          [status, subscription.current_period_end, subscription.customer]
        );
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await pool.execute(`UPDATE users SET subscription_status = 'canceled' WHERE stripe_customer_id = ?`, [
          subscription.customer,
        ]);
        break;
      }
      default:
        break;
    }

    res.json({ received: true });
  })
);

export default router;
