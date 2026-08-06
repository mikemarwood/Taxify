import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireAccountOwner } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStripe, getStripeConfig, priceIdForPlan, planTypeForPriceId } from '../lib/stripe.js';
import { invoicesDir, invoiceFilename, shapeInvoice, isStored, storeInvoicePdf } from '../lib/invoiceStorage.js';
import { serveAttachment } from '../lib/serveAttachment.js';

const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

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

    // A guard used to sit here refusing a downgrade while a second full login
    // existed. There are no second logins now. What a downgrade actually has
    // to consider is the business books it leaves the account over the limit
    // of, and that is handled on creating a set of books — so nothing is ever
    // deleted because a plan changed.

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

// What changing plan will actually cost, worked out by Stripe rather than by
// us.
//
// Swapping the price on a live subscription keeps its renewal date, and Stripe
// prorates: it credits the unused part of what they have and charges the used
// part of what they are moving to. Somebody four months into a $79 year moving
// to $149 pays the difference for the eight months left, not $149 — and their
// renewal date does not move.
//
// Asking Stripe rather than doing the arithmetic here matters, because Stripe
// is what will actually bill them. Any sum we computed ourselves would be a
// second opinion that could disagree with the invoice.
router.get(
  '/change-preview',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const planType = req.query.planType === 'business' ? 'business' : 'individual';

    const [rows] = await pool.execute(
      'SELECT stripe_customer_id, stripe_subscription_id, plan_type FROM users WHERE id = ?',
      [req.user.id]
    );
    const customerId = rows[0]?.stripe_customer_id;
    const subscriptionId = rows[0]?.stripe_subscription_id;

    // Nothing live to prorate against — checkout will quote the full price.
    if (!customerId || !subscriptionId || req.user.subscriptionStatus !== 'active') {
      return res.json({ preview: null, reason: 'no_subscription' });
    }
    if (rows[0].plan_type === planType) {
      return res.json({ preview: null, reason: 'same_plan' });
    }

    const stripe = await getStripe();
    const priceId = await priceIdForPlan(planType);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items?.data?.[0]?.id;
    if (!itemId) return res.json({ preview: null, reason: 'no_subscription' });

    let invoice;
    try {
      invoice = await stripe.invoices.createPreview({
        customer: customerId,
        subscription: subscriptionId,
        subscription_details: {
          items: [{ id: itemId, price: priceId }],
          proration_behavior: 'create_prorations',
        },
      });
    } catch (err) {
      // A preview failing must not stop somebody changing plan — it only means
      // we cannot show the figure first.
      console.error('Could not preview the plan change', err.message);
      return res.json({ preview: null, reason: 'unavailable' });
    }

    // Only the proration lines. The rest of a preview invoice is next period's
    // ordinary charge, which is not what this change costs.
    const prorations = (invoice.lines?.data || []).filter((line) => line.proration);
    const dueNow = prorations.reduce((sum, line) => sum + (line.amount || 0), 0);

    res.json({
      preview: {
        planType,
        // Negative means they are in credit — a downgrade leaves money on the
        // account rather than refunding it, and saying so avoids a surprise.
        dueNow,
        credit: dueNow < 0 ? Math.abs(dueNow) : 0,
        currency: (invoice.currency || 'aud').toUpperCase(),
        // Unchanged by the swap. Stating it is the reassurance that the year
        // they already paid for is not being restarted.
        renewsAt: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
      },
    });
  })
);

// ----------------------------------------------------------------- invoices

// Every invoice Stripe has for this customer, newest first, with the PDFs
// pulled down and kept so they stay reachable from the account page.
router.get(
  '/invoices',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT stripe_customer_id FROM users WHERE id = ?', [req.user.id]);
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.json({ invoices: [] });

    const stripe = await getStripe();
    const list = await stripe.invoices.list({ customer: customerId, limit: 24 });

    const invoices = [];
    for (const invoice of list.data) {
      // Kept as they are listed rather than by a nightly job: it is the moment
      // we know the invoice exists and have a URL that has not expired.
      if (!isStored(uploadsDir, req.user.id, invoice)) {
        try {
          await storeInvoicePdf(uploadsDir, req.user.id, invoice);
        } catch (err) {
          // A PDF that will not download must not empty the list — the row
          // still shows, and Stripe's hosted copy still opens.
          console.error(`Could not store invoice ${invoice.id}`, err.message);
        }
      }
      invoices.push(shapeInvoice(invoice, { stored: isStored(uploadsDir, req.user.id, invoice) }));
    }

    res.json({ invoices });
  })
);

// The PDF itself, served from us.
//
// The invoice is fetched from Stripe first for one reason: to check it belongs
// to this customer. Serving a file straight out of the folder on a name from
// the URL would let somebody read another account's invoice by guessing a
// filename.
router.get(
  '/invoices/:id/pdf',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT stripe_customer_id FROM users WHERE id = ?', [req.user.id]);
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(404).json({ error: 'No billing account yet' });

    const stripe = await getStripe();
    let invoice;
    try {
      invoice = await stripe.invoices.retrieve(req.params.id);
    } catch {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // The whole point of the round trip.
    const owner = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (owner !== customerId) return res.status(404).json({ error: 'Invoice not found' });

    let filePath = path.join(invoicesDir(uploadsDir, req.user.id), invoiceFilename(invoice));
    if (!fs.existsSync(filePath)) {
      filePath = await storeInvoicePdf(uploadsDir, req.user.id, invoice);
      if (!filePath) {
        return res.status(409).json({ error: 'Stripe has not produced a PDF for this invoice yet' });
      }
    }

    return serveAttachment(res, filePath, { originalName: invoiceFilename(invoice), download: true });
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

        // The plan follows the price, not just the status. Stripe's billing
        // portal lets a customer change plan without ever touching us, and
        // this was the event that arrived afterwards — it updated the status
        // and left plan_type alone, so somebody could pay for one plan and
        // keep the entitlement of the other.
        //
        // Left as it was when the price is not one we recognise: guessing
        // either bills for what they cannot use, or gives away what they have
        // not bought.
        const priceId = subscription.items?.data?.[0]?.price?.id || null;
        const planFromPrice = await planTypeForPriceId(priceId);

        await pool.execute(
          `UPDATE users SET subscription_status = ?, subscription_current_period_end = FROM_UNIXTIME(?)
             ${planFromPrice ? ', plan_type = ?' : ''}
           WHERE stripe_customer_id = ?`,
          planFromPrice
            ? [status, subscription.current_period_end, planFromPrice, subscription.customer]
            : [status, subscription.current_period_end, subscription.customer]
        );
        break;
      }
      // Kept the moment it is paid, so the copy on the account page is not
      // waiting for somebody to open the billing tab.
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const [owner] = await pool.execute('SELECT id FROM users WHERE stripe_customer_id = ?', [customerId]);
          if (owner[0]?.id) {
            try {
              await storeInvoicePdf(uploadsDir, owner[0].id, invoice);
            } catch (err) {
              // Never fail the webhook over a file. Stripe retries a failure,
              // and the list route stores it on the next visit anyway.
              console.error(`Could not store invoice ${invoice.id} from webhook`, err.message);
            }
          }
        }
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
