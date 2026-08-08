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
import { publicOrigin } from '../lib/publicOrigin.js';
import { notify, notifyAdmins } from '../lib/notify.js';
import { planLabel } from '../lib/planLimits.js';
import { shouldApplyPayment } from '../lib/planRequests.js';
import { generateReference } from '../lib/support.js';

const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

const CLIENT_ORIGIN = publicOrigin();

const router = Router();

function shapeRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    fromPlan: row.from_plan,
    toPlan: row.to_plan,
    status: row.status,
    note: row.note,
    invoiceUrl: row.invoice_url,
    invoiceAmountCents: row.invoice_amount_cents,
    invoiceCurrency: row.invoice_currency,
    stripeInvoiceId: row.stripe_invoice_id,
    invoicedAt: row.invoiced_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}


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

    // Stripe refuses to open a portal until a portal configuration has been
    // saved in the dashboard, and it is not created for you — a Stripe account
    // that has never visited Settings > Billing > Customer portal has none. The
    // error it throws is about 'no configuration provided', which means nothing
    // to whoever pressed the button and looks exactly like the button being
    // broken. Said plainly instead, with the place to go and fix it.
    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${CLIENT_ORIGIN}/account`,
      });
    } catch (err) {
      const message = String(err?.message || '');
      console.error('Stripe billing portal failed', message);

      if (/configuration/i.test(message)) {
        return res.status(503).json({
          error:
            'The billing portal has not been set up in Stripe yet. In the Stripe dashboard: Settings, Billing, Customer portal — save a configuration, then this will work.',
        });
      }
      if (/No such customer/i.test(message)) {
        return res.status(409).json({
          error: 'Your billing record was not found in Stripe. This can happen after switching between live and test mode.',
        });
      }
      return res.status(502).json({ error: `Stripe could not open the billing portal: ${message}` });
    }

    res.json({ url: session.url });
  })
);


// ---------------------------------------------------------------------------
// Plan changes that go through an administrator.
//
// Self-serve checkout still exists and is still the normal path. This is the
// other one: somebody asks to move plan, an administrator quotes it and sends
// an invoice, and the plan moves when that invoice is paid. Nothing here
// charges a card — the money is Stripe's business, and the plan only follows
// once Stripe says it arrived.
// ---------------------------------------------------------------------------

// What this account has asked for, so the page can show it rather than letting
// somebody ask three times.
router.get(
  '/plan-change-request',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT * FROM plan_change_requests
        WHERE user_id = ? AND status IN ('pending', 'invoiced')
        ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ request: rows[0] ? shapeRequest(rows[0]) : null });
  })
);

router.post(
  '/plan-change-request',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const toPlan = req.body?.planType === 'business' ? 'business' : 'individual';
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;

    if (toPlan === req.user.planType) {
      return res.status(400).json({ error: 'You are already on that plan' });
    }

    // One open request at a time. Two invoices for the same move is the worst
    // outcome here, and "I already asked" is the more common complaint than
    // "I could not ask twice".
    const [open] = await pool.execute(
      `SELECT id FROM plan_change_requests WHERE user_id = ? AND status IN ('pending', 'invoiced')`,
      [req.user.id]
    );
    if (open[0]) return res.status(409).json({ error: 'You already have a plan change waiting' });

    const [result] = await pool.execute(
      `INSERT INTO plan_change_requests (user_id, from_plan, to_plan, note) VALUES (?, ?, ?, ?)`,
      [req.user.id, req.user.planType || null, toPlan, note]
    );

    // Raised as a support ticket too, so it lands in the same queue as
    // everything else somebody writes in about and can be replied to like any
    // other question. Failure here must not lose the request itself, which is
    // already saved.
    try {
      const reference = generateReference();
      const [ticket] = await pool.execute(
        `INSERT INTO support_tickets (reference, user_id, category, subject, status, last_message_at, plan_change_request_id)
         VALUES (?, ?, 'billing', ?, 'awaiting_support', NOW(), ?)`,
        [reference, req.user.id, `Plan change to ${planLabel(toPlan)}`, result.insertId]
      );
      await pool.execute(
        `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
         VALUES (?, ?, 'customer', ?, ?)`,
        [
          ticket.insertId,
          req.user.id,
          req.user.name || req.user.email,
          [
            `I would like to move from ${planLabel(req.user.planType)} to ${planLabel(toPlan)}.`,
            note ? `\n\n${note}` : '',
          ].join(''),
        ]
      );
    } catch (err) {
      console.error('Could not raise a ticket for the plan change', err);
    }

    await notifyAdmins({
      title: `${req.user.name || req.user.email} wants to move to ${planLabel(toPlan)}`,
      body: note || `Currently on ${planLabel(req.user.planType)}. Send them an invoice to complete it.`,
      url: '/admin?tab=support',
      kind: 'billing',
    });

    const [rows] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [result.insertId]);
    res.json({ request: shapeRequest(rows[0]) });
  })
);

router.delete(
  '/plan-change-request/:id',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute(
      `UPDATE plan_change_requests SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = ? AND user_id = ? AND status IN ('pending', 'invoiced')`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });

    await notifyAdmins({
      title: `${req.user.name || req.user.email} cancelled their plan change`,
      body: 'Nothing to invoice. Void the invoice in Stripe if one was already sent.',
      url: '/admin?tab=support',
      kind: 'billing',
    });
    res.json({ ok: true });
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
      // An invoice an administrator raised for a plan change has been paid.
      //
      // This is the only thing that moves a plan on this path. Stripe saying
      // the money arrived is the authority — an administrator marking it paid
      // by hand would be a guess, and the customer's own word even more so.
      case 'invoice.paid': {
        const invoice = event.data.object;
        const requestId = Number(invoice.metadata?.planChangeRequestId);
        // Subscription renewals are invoices too. Without this, every renewal
        // would fall through the lookup below.
        if (!requestId) break;

        const [rows] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [requestId]);
        const request = rows[0];

        const verdict = shouldApplyPayment({ requestId, request });
        if (!verdict.apply) {
          // Money that arrived against a request somebody had already cancelled
          // is a real payment for something we are not about to grant, so it is
          // said out loud rather than dropped.
          if (verdict.reason === 'cancelled_but_paid') {
            console.error(`Invoice ${invoice.id} paid against cancelled plan request ${requestId}`);
            await notifyAdmins({
              title: 'A cancelled plan change was paid',
              body: 'Stripe took a payment for a request that had been cancelled. Refund it, or reinstate the plan by hand.',
              url: '/admin?tab=support',
              kind: 'billing',
            }).catch(() => {});
          }
          break;
        }

        await pool.execute(
          `UPDATE plan_change_requests SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ?`,
          [requestId]
        );

        // The change they paid for. Only plan_type moves: whatever subscription
        // they already had keeps its own dates and status, because this invoice
        // was a one-off and did not renew anything.
        await pool.execute('UPDATE users SET plan_type = ? WHERE id = ?', [request.to_plan, request.user_id]);

        // Kept now, while there is a URL that has not expired. The customer's
        // invoice list stores lazily when it is opened, and somebody who never
        // opens it would otherwise have no copy of what they paid.
        try {
          if (!isStored(uploadsDir, request.user_id, invoice)) {
            await storeInvoicePdf(uploadsDir, request.user_id, invoice);
          }
        } catch (err) {
          console.error(`Could not store plan-change invoice ${invoice.id}`, err.message);
        }

        const [who] = await pool.execute('SELECT name, email FROM users WHERE id = ?', [request.user_id]);
        const label = planLabel(request.to_plan);

        try {
          await notify(request.user_id, {
            title: `You are now on ${label}`,
            body: 'Your payment came through and the plan has been applied. The invoice is on your billing page.',
            url: '/account?tab=billing',
            kind: 'billing',
          });
          await notifyAdmins({
            title: `${who[0]?.name || who[0]?.email || 'A customer'} paid for ${label}`,
            body: 'The plan has been applied automatically and the invoice is stored against their account.',
            url: '/admin?tab=support',
            kind: 'billing',
          });
        } catch (err) {
          // The plan has already moved and the money has already arrived.
          // Failing the webhook here would make Stripe retry a payment that was
          // fully handled.
          console.error('Could not send plan-change notifications', err);
        }
        break;
      }
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
