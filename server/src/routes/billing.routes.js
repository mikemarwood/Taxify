import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireAccountOwner } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getStripe, priceIdForPlan } from '../lib/stripe.js';

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const router = Router();

router.post(
  '/checkout',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const stripe = getStripe();
    const planType = req.user.planType || 'individual';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: req.user.stripeCustomerId || undefined,
      customer_email: req.user.stripeCustomerId ? undefined : req.user.email,
      line_items: [{ price: priceIdForPlan(planType), quantity: 1 }],
      client_reference_id: String(req.user.id),
      metadata: { userId: String(req.user.id) },
      success_url: `${CLIENT_ORIGIN}/account?checkout=success`,
      cancel_url: `${CLIENT_ORIGIN}/account?checkout=cancelled`,
    });

    res.json({ url: session.url });
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

    const stripe = getStripe();
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
    const stripe = getStripe();
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
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
          await pool.execute(
            `UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = 'active',
             subscription_current_period_end = FROM_UNIXTIME(?) WHERE id = ?`,
            [session.customer, subscription.id, subscription.current_period_end, userId]
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
