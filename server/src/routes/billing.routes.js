import { Router } from 'express';
import pool, { setSetting, getSetting } from '../db.js';
import { requireAuth, requireAccountOwner } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getStripe,
  getStripeConfig,
  priceIdForPlan,
  oneOffPriceIdForPlan,
  planTypeForPriceId,
} from '../lib/stripe.js';
import { invoicesDir, invoiceFilename, shapeInvoice, isStored, storeInvoicePdf } from '../lib/invoiceStorage.js';
import { serveAttachment } from '../lib/serveAttachment.js';
import { publicOrigin, appOrigin } from '../lib/publicOrigin.js';
import { sendAdminPaymentEmail } from '../lib/mailer.js';
import { formatMoney } from '../lib/exportMoney.js';
import { notify, notifyAdmins } from '../lib/notify.js';
import { planLabel } from '../lib/planLimits.js';
import { shouldApplyPayment } from '../lib/planRequests.js';
import { generateReference } from '../lib/support.js';
import {
  applyDiscount,
  evaluatePromoCode,
  normalisePromoCode,
  pendingPromoFor,
  recordPromoRedemption,
  stripeCouponFor,
  toPublicPromo,
} from '../lib/promoCodes.js';
import { getSignupPlans } from '../lib/stripe.js';

const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

// Where Stripe sends somebody back to, which is a page inside the app.
//
// Evaluated once at import, which is fine for an origin that cannot change
// while the process is running — but it is /app now, not the root, or a
// completed checkout lands on the marketing page.
const CLIENT_ORIGIN = appOrigin();

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
    ticketId: row.ticket_id ?? null,
    ticketReference: row.ticket_reference ?? null,
    ticketStatus: row.ticket_status ?? null,
  };
}

// What counts as a request still in the way.
//
// A request used to block another simply by being pending or invoiced, for
// ever. So somebody who asked to move, was answered, and had the ticket closed
// without an invoice could never ask again — the card sat inert with nothing
// on the other end of it.
//
// The rule now follows the conversation: a request that has not been invoiced
// stops blocking once its ticket is closed, because the closing of the ticket
// is what says we are done with it. An invoiced one keeps blocking whatever the
// ticket says, since there is real money outstanding against it and a second
// request for the same move is how somebody ends up with two invoices.
const OUTSTANDING = `
  r.status = 'invoiced'
  OR (r.status = 'pending' AND (t.id IS NULL OR t.status <> 'closed'))
`;


// The promo code on this account, and what it is worth.
//
// A code typed at registration was written to the account and then never
// mentioned again: the plans page quoted the full price, so somebody who had
// been given twenty per cent off had no way to tell whether it had been taken
// or lost. The discount was real — checkout applied it — but nobody could see
// that until the Stripe page, which is far too late to be reassured by.
//
// Priced against both plans rather than one, because a code can be scoped to a
// plan and the answer to "what does this save me" differs per card. A plan the
// code does not apply to comes back with a null discount, which is the honest
// answer and what the card needs to know to say nothing.
async function promoState(userId) {
  const [rows] = await pool.execute('SELECT promo_code, promo_redeemed_at FROM users WHERE id = ?', [userId]);
  const held = rows[0]?.promo_code || null;
  const redeemedAt = rows[0]?.promo_redeemed_at || null;
  const plans = await getSignupPlans();

  if (!held) return { promo: null, redeemed: false, plans: plans.map(planPricing) };

  const [promos] = await pool.execute('SELECT * FROM promo_codes WHERE code = ?', [held]);
  const promo = promos[0];
  // Held on the account but gone from the table, which happens when a code is
  // deleted. Reported as held with nothing off, rather than as no code at all,
  // so somebody is not invited to type a second one they cannot have.
  if (!promo) return { promo: { code: held }, redeemed: Boolean(redeemedAt), usable: false, plans: plans.map(planPricing) };

  const usable =
    !redeemedAt &&
    Boolean(promo.active) &&
    !(promo.expires_at && new Date(promo.expires_at) < new Date()) &&
    !(promo.max_uses !== null && promo.used_count >= promo.max_uses);

  return {
    promo: toPublicPromo(promo),
    redeemed: Boolean(redeemedAt),
    usable,
    plans: plans.map((plan) => {
      const applies = usable && (!promo.plan_type || promo.plan_type === plan.planType);
      return {
        ...planPricing(plan),
        discountedPerYear: applies ? applyDiscount(promo, plan.amountPerYear) : null,
      };
    }),
  };
}

function planPricing(plan) {
  return {
    planType: plan.planType,
    name: plan.name,
    currency: plan.currency,
    amountPerYear: plan.amountPerYear,
    discountedPerYear: null,
  };
}

// The account holder's own, and only theirs. An accountant sitting inside a
// client's books is not the person who pays for them, and req.user under that
// session is not the person whose discount this would be.
router.get(
  '/promo',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    res.json(await promoState(req.user.id));
  })
);

// Adding one after the fact.
//
// The code box was only on the registration form, so somebody who was sent a
// code the week after they signed up had nowhere to type it. This is that box,
// and the account holder's alone: a promo discounts the account's own
// subscription, and an accountant with access to somebody's books is not the
// person who pays for them.
//
// One per account, whether or not it has been spent. A second code would have
// to either replace the first — quietly taking away a discount somebody was
// promised — or stack, which is a decision about money that nobody has made.
// Refusing plainly is the only version of this that cannot go wrong, and the
// message says which code is already on the account so it is clear nothing was
// lost.
router.post(
  '/promo',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT promo_code, plan_type FROM users WHERE id = ?', [req.user.id]);
    const held = rows[0]?.promo_code || null;
    if (held) {
      return res.status(409).json({ error: `This account already has promo code ${held} on it.` });
    }

    const code = normalisePromoCode(req.body?.code);
    if (!code) return res.status(400).json({ error: 'Enter a promo code' });

    // Checked against every plan, not just the one they are on. A code scoped
    // to Small Business is a perfectly good code for somebody about to choose
    // Small Business, and refusing it because their account still says
    // Individual would be refusing it for the plan they are leaving.
    const plans = await getSignupPlans();
    let accepted = null;
    let reason = 'Invalid promo code';
    for (const plan of plans) {
      const result = await evaluatePromoCode(code, plan.planType, plan.amountPerYear);
      if (result.ok) {
        accepted = result;
        break;
      }
      reason = result.reason;
    }
    if (!accepted) return res.status(400).json({ error: reason });

    // Written only if nothing has been written since we looked. Two tabs, two
    // codes, and the first one in wins — rather than the second quietly
    // replacing it.
    const [written] = await pool.execute(
      'UPDATE users SET promo_code = ? WHERE id = ? AND promo_code IS NULL',
      [code, req.user.id]
    );
    if (!written.affectedRows) {
      return res.status(409).json({ error: 'This account already has a promo code on it.' });
    }

    // Counted the same as a code typed on the sign-up form, because max_uses
    // means "how many accounts may have this" and an account that took the
    // code late is still an account that took it. Left uncounted, a code
    // capped at fifty could be claimed by any number of existing customers.
    await recordPromoRedemption(code);

    res.json(await promoState(req.user.id));
  })
);

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

    // The promo code they registered with, applied to the first payment only.
    //
    // Until now a code was checked at registration, written on the account, and
    // then had no effect whatever — checkout charged the full price. It is read
    // here rather than there because this is the moment money changes hands, and
    // a code can lapse or be exhausted in between.
    //
    // The coupon is created with duration 'once'. Stripe's default is 'forever',
    // which would take the discount off every renewal for as long as somebody
    // stayed subscribed — a code meant to win one customer would quietly cost
    // the difference every year after.
    let discounts;
    let promoUsed = null;
    try {
      const promo = await pendingPromoFor(req.user.id, planType);
      if (promo) {
        discounts = [{ coupon: await stripeCouponFor(stripe, promo) }];
        promoUsed = promo.code;
      }
    } catch (err) {
      // A promo that cannot be turned into a coupon must not stop somebody
      // paying. They are charged full price and we find out from the log.
      console.error('Could not apply promo code at checkout', err);
    }

    // Paying once, or subscribing.
    //
    // Stripe will not sell a recurring price in payment mode, so the two are
    // genuinely different price objects and the mode has to match the one being
    // charged. Asked for explicitly rather than inferred: a request that does
    // not say gets the subscription, which is what every existing caller meant.
    const payOnce = req.body?.billing === 'once';
    const onceId = payOnce ? await oneOffPriceIdForPlan(planType) : null;

    // Refused rather than quietly subscribing them. Somebody who chose to pay
    // once and was signed up to a yearly charge instead has been sold something
    // they declined.
    if (payOnce && !onceId) {
      return res.status(400).json({
        error: 'Paying once is not set up for that plan yet. Choose the subscription, or ask us to sort it out.',
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: payOnce ? 'payment' : 'subscription',
      customer: req.user.stripeCustomerId || undefined,
      customer_email: req.user.stripeCustomerId ? undefined : req.user.email,
      line_items: [{ price: payOnce ? onceId : priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      // A one-off has no subscription behind it to carry a customer forward, so
      // Stripe is asked to keep one — otherwise the next payment creates a
      // second customer and their invoices end up split across two.
      ...(payOnce ? { customer_creation: req.user.stripeCustomerId ? undefined : 'always' } : {}),
      client_reference_id: String(req.user.id),
      metadata: {
        userId: String(req.user.id),
        planType,
        billing: payOnce ? 'once' : 'auto',
        ...(promoUsed ? { promoCode: promoUsed } : {}),
      },
      success_url: `${CLIENT_ORIGIN}/account?checkout=success`,
      cancel_url: `${CLIENT_ORIGIN}/account?checkout=cancelled`,
    });

    res.json({ url: session.url });
  })
);

// What to write for the end of the paid period.
//
// COALESCE(new, old) was the first attempt, to stop a renewal that arrived
// without a date wiping the one it was extending. It does something worse: it
// keeps the OLD date, which for a renewal is a date in the past — so the row
// ends up saying active with an end date that has already gone, and
// isRowActive reads that as lapsed. Somebody pays, Stripe confirms it, the
// status flips to active, and they stay locked out.
//
// A live subscription with no readable end date is written as NULL instead,
// which isRowActive treats as "active, no known end". When Stripe says the
// subscription is live, erring towards access is right; erring towards a
// lockout is the failure that takes money and gives nothing back. A date is
// only ever preserved for a subscription that is *not* live, where there is
// nothing to grant either way.
function periodEndFor(status, seconds) {
  if (seconds) return { value: seconds, keepOld: false };
  return { value: null, keepOld: status !== 'active' };
}

// Ask Stripe what the truth is, now.
//
// Everything about a subscription reached us by webhook, and a webhook is a
// promise from another machine. If it is delayed, mis-configured, or the
// event was never enabled in the dashboard, somebody pays to renew, is sent
// back to their account, and finds themselves still locked out — holding a
// receipt. That is the worst failure this app has, because from their side it
// is indistinguishable from being robbed.
//
// The person is standing right there when they come back from checkout, so
// this asks Stripe directly rather than waiting to be told. Idempotent, and
// safe to call at any time: it only ever copies what Stripe says.
router.post(
  '/sync',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const stripe = await getStripe();

    // The customer id may not be on our row yet — a first checkout creates
    // the customer at Stripe, and that fact reaches us in the same webhook
    // that has not arrived. Found by email in that case.
    let customerId = req.user.stripeCustomerId || null;
    if (!customerId) {
      const found = await stripe.customers.list({ email: req.user.email, limit: 1 });
      customerId = found.data[0]?.id || null;
    }
    if (!customerId) return res.json({ ok: true, changed: false });

    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    // The one that is actually giving them access. Several can exist — an old
    // cancelled one and a new one — and the newest is not always the live one.
    const live =
      subs.data.find((sub) => sub.status === 'active' || sub.status === 'trialing') ||
      subs.data.find((sub) => sub.status === 'past_due') ||
      null;

    if (!live) {
      await pool.execute('UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?', [
        customerId,
        req.user.id,
      ]);
      return res.json({ ok: true, changed: false });
    }

    const status = live.status === 'past_due' ? 'past_due' : 'active';
    const priceId = live.items?.data?.[0]?.price?.id || null;
    const planFromPrice = await planTypeForPriceId(priceId);

    // current_period_end moved onto the subscription item in Stripe's 2025
    // API versions. Read from both, so this keeps working whichever version
    // the account is pinned to rather than writing a null period end.
    const periodEnd = live.current_period_end || live.items?.data?.[0]?.current_period_end || null;

    const ends = periodEndFor(status, periodEnd);
    await pool.execute(
      `UPDATE users
          SET stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = ?,
              plan_type = COALESCE(?, plan_type),
              subscription_current_period_end = ${
                ends.keepOld ? 'subscription_current_period_end' : 'FROM_UNIXTIME(?)'
              }
        WHERE id = ?`,
      ends.keepOld
        ? [customerId, live.id, status, planFromPrice, req.user.id]
        : [customerId, live.id, status, planFromPrice, ends.value, req.user.id]
    );

    res.json({ ok: true, changed: true, status, periodEnd });
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
      // Voided and draft invoices are left out.
      //
      // A voided one was withdrawn — the bill was taken back and there is
      // nothing to pay — and a draft was never issued at all. Both were
      // appearing in the customer's own list alongside real ones, so somebody
      // whose wrong invoice we had corrected could see both, with no way to
      // tell which of the two they owed.
      if (invoice.status === 'void' || invoice.status === 'draft') continue;
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
      `SELECT r.*, t.id AS ticket_id, t.reference AS ticket_reference, t.status AS ticket_status
         FROM plan_change_requests r
         LEFT JOIN support_tickets t ON t.plan_change_request_id = r.id
        WHERE r.user_id = ? AND (${OUTSTANDING})
        ORDER BY r.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ request: rows[0] ? shapeRequest(rows[0]) : null });
  })
);

// Anything about money that is waiting on them.
//
// Polled for the badge beside My account, so it has to be cheap and it has to
// be honest: a red number that turns out to mean nothing trains somebody to
// ignore the next one. It counts only things they can actually do something
// about right now — an invoice sitting unpaid, or access already lost.
//
// The same answer drives the plan cards, which is why the request itself comes
// back with it. Two polls asking the same question would be two chances to
// disagree about the answer.
router.get(
  '/attention',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT r.*, t.id AS ticket_id, t.reference AS ticket_reference, t.status AS ticket_status
         FROM plan_change_requests r
         LEFT JOIN support_tickets t ON t.plan_change_request_id = r.id
        WHERE r.user_id = ? AND (${OUTSTANDING})
        ORDER BY r.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    const request = rows[0] ? shapeRequest(rows[0]) : null;

    const reasons = [];
    if (request?.status === 'invoiced') reasons.push('invoice');
    // Already shut out. Nothing is more worth a red number than the reason
    // somebody cannot get into their own records.
    if (req.user.accessLocked) reasons.push('locked');
    else if (req.user.subscriptionStatus === 'past_due') reasons.push('past_due');

    res.json({
      count: reasons.length,
      reasons,
      request,
      planType: req.user.planType || null,
      subscriptionStatus: req.user.subscriptionStatus || null,
    });
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

    // Moving down is only offered once the plan has run out.
    //
    // Small Business covers books that Individual does not, and a downgrade
    // shuts them — read-only, nothing lost, but shut. Doing that in the middle
    // of a paid year takes away something already paid for, and leaves us
    // owing a refund nobody agreed on. At the end of the year there is nothing
    // to take away: the books are already locked because the plan has lapsed,
    // and choosing Individual is choosing what to pay for next rather than
    // giving something up.
    //
    // Moving *up* is unrestricted. Nobody needs protecting from buying more.
    const goingDown = req.user.planType === 'business' && toPlan === 'individual';
    if (goingDown && !req.user.accessLocked) {
      return res.status(400).json({
        error:
          'You can move down to Individual when your current plan ends. Until then it is paid for, and Individual ' +
          'covers fewer sets of books — so switching now would shut some of yours with time still left on them.',
      });
    }

    // One open request at a time. Two invoices for the same move is the worst
    // outcome here, and "I already asked" is the more common complaint than
    // "I could not ask twice".
    const [open] = await pool.execute(
      `SELECT r.id, r.to_plan, r.status, r.stripe_invoice_id FROM plan_change_requests r
         LEFT JOIN support_tickets t ON t.plan_change_request_id = r.id
        WHERE r.user_id = ? AND (${OUTSTANDING}) LIMIT 1`,
      [req.user.id]
    );

    // An outstanding request for the *same* plan is the one they already made.
    // Saying "you already have one waiting" is the right answer there.
    if (open[0] && open[0].to_plan === toPlan) {
      return res.status(409).json({ error: 'You already have a request waiting for that plan' });
    }

    // A request for a different plan supersedes it.
    //
    // Refusing outright was the old behaviour, and it left somebody who had
    // changed their mind stuck behind their own earlier request with nothing
    // they could do about it — the only way out was to write in and ask.
    // Withdrawing the first is the honest resolution: two live requests for
    // two different plans is a state nobody can act on, and the second is the
    // one they mean.
    if (open[0]) {
      if (open[0].stripe_invoice_id) {
        // The bill goes with it. Leaving it open would let them pay for the
        // plan they just changed their mind about.
        try {
          const stripe = await getStripe();
          await stripe.invoices.voidInvoice(open[0].stripe_invoice_id);
        } catch (err) {
          // Already paid, most likely. Refused rather than superseded — the
          // money has arrived for a plan they are about to be moved off, and
          // that is a person's decision, not a webhook's.
          return res.status(409).json({
            error:
              'The invoice for your last request has already been paid, so it cannot be replaced. Reply on your support ticket and we will sort it out.',
          });
        }
      }
      await pool.execute(
        `UPDATE plan_change_requests
            SET status = 'cancelled', cancelled_at = NOW(),
                voided_at = CASE WHEN stripe_invoice_id IS NULL THEN voided_at ELSE NOW() END,
                updated_at = NOW()
          WHERE id = ?`,
        [open[0].id]
      );
      await notifyAdmins({
        title: `${req.user.name || req.user.email} changed which plan they want`,
        body: 'Their earlier request has been withdrawn and any invoice on it voided. A new one is in the queue.',
        url: '/admin?tab=support',
        kind: 'billing',
      }).catch(() => {});
    }

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
    const [rows] = await pool.execute(
      `SELECT * FROM plan_change_requests
        WHERE id = ? AND user_id = ? AND status IN ('pending', 'invoiced')`,
      [req.params.id, req.user.id]
    );
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Not found' });

    // The bill goes with the request.
    //
    // This used to cancel the row and tell an administrator to "void the
    // invoice in Stripe if one was already sent" — a note asking a person to
    // remember something, which is the same as leaving a live, payable invoice
    // against a request nobody is going to honour. The customer withdrew it and
    // could still be charged for it.
    //
    // Stripe goes first. If it refuses, nothing here changes: a request marked
    // cancelled while its invoice is still open in Stripe is the precise state
    // this exists to prevent.
    if (request.stripe_invoice_id) {
      const stripe = await getStripe();
      try {
        await stripe.invoices.voidInvoice(request.stripe_invoice_id);
      } catch (err) {
        if (err?.code === 'invoice_not_open' || /paid/i.test(err?.message || '')) {
          return res.status(409).json({
            error:
              'That invoice has already been paid, so it cannot be withdrawn here. Reply on your support ticket and we will sort it out.',
          });
        }
        return res.status(502).json({ error: 'We could not withdraw the invoice just now. Please try again shortly.' });
      }
    }

    await pool.execute(
      `UPDATE plan_change_requests
          SET status = 'cancelled', cancelled_at = NOW(),
              voided_at = CASE WHEN stripe_invoice_id IS NULL THEN voided_at ELSE NOW() END,
              updated_at = NOW()
        WHERE id = ?`,
      [request.id]
    );

    await notifyAdmins({
      title: `${req.user.name || req.user.email} withdrew their plan change`,
      body: request.stripe_invoice_id
        ? 'The invoice has been voided in Stripe. Nothing is owed.'
        : 'Nothing had been invoiced.',
      url: '/admin?tab=support',
      kind: 'billing',
    }).catch(() => {});

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

    // Recorded before anything is acted on, and never allowed to fail the
    // webhook. This is how the admin panel can say "the last one arrived four
    // minutes ago" rather than only "Stripe says it is configured" — a
    // configured endpoint that is being rejected on a stale signing secret
    // looks identical from Stripe's side, and that is the failure that cost a
    // customer their access.
    //
    // Only reached after the signature has verified, so it means a genuine
    // delivery we understood, not merely a request arriving.
    setSetting('stripe_webhook_last_event', `${event.type}|${new Date().toISOString()}`).catch(() => {});

    switch (event.type) {
      // An invoice an administrator raised for a plan change has been paid.
      //
      // This is the only thing that moves a plan on this path. Stripe saying
      // the money arrived is the authority — an administrator marking it paid
      // by hand would be a guess, and the customer's own word even more so.
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;

        // Every paid invoice is kept, whatever it was for — a renewal, a first
        // subscription, or a plan change. Done first and unconditionally,
        // because it applies to all of them and because the copy on the account
        // page should not wait for somebody to open the billing tab.
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const [owner] = await pool.execute('SELECT id FROM users WHERE stripe_customer_id = ?', [customerId]);

          // Written down as it happens, so the admin panel can answer "what
          // came in this week" without calling Stripe and paging through
          // invoices on every load. INSERT IGNORE against a unique invoice id:
          // webhooks are delivered more than once, and a retried delivery must
          // not count the same payment twice.
          try {
            await pool.execute(
              `INSERT IGNORE INTO payments
                 (user_id, stripe_invoice_id, amount_cents, currency, kind, description, invoice_url, paid_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
              [
                owner[0]?.id ?? null,
                invoice.id,
                invoice.amount_paid ?? 0,
                (invoice.currency || 'aud').toUpperCase(),
                invoice.metadata?.planChangeRequestId ? 'plan_change' : 'subscription',
                (invoice.description || invoice.lines?.data?.[0]?.description || null)?.slice(0, 300) ?? null,
                invoice.hosted_invoice_url || null,
              ]
            );
          } catch (err) {
            // Never fail the webhook over bookkeeping. Stripe retries a
            // failure, and a retry would redo the parts that already worked.
            console.error('Could not record the payment', err.message);
          }

          // Tell whoever runs the place, once.
          //
          // Gated on the INSERT IGNORE above having actually inserted, which
          // is what makes this safe against Stripe's redeliveries: a webhook
          // arriving twice records one payment and sends one email. Reading
          // affectedRows rather than trying to remember what has been sent.
          try {
            const [[fresh]] = await pool.execute(
              'SELECT id FROM payments WHERE stripe_invoice_id = ? AND notified_admins_at IS NULL',
              [invoice.id]
            );
            if (fresh) {
              await pool.execute('UPDATE payments SET notified_admins_at = NOW() WHERE id = ?', [fresh.id]);

              const [admins] = await pool.query(
                "SELECT email, name FROM users WHERE is_admin = 1 AND activated_at IS NOT NULL"
              );
              const [[who]] = owner[0]?.id
                ? await pool.execute('SELECT name, email FROM users WHERE id = ?', [owner[0].id])
                : [[null]];

              const money = formatMoney((invoice.amount_paid ?? 0) / 100, (invoice.currency || 'aud').toUpperCase());

              // In the bell as well as the inbox. An email is read when
              // somebody next opens their mail; a notification is there the
              // moment they next open the panel, which for money arriving is
              // the sooner of the two more often than not.
              //
              // Pointed at the stats tab, which is where the recent payments
              // list lives — a notification that lands you somewhere you then
              // have to navigate away from is one you stop pressing.
              await notifyAdmins({
                title: `${money} received`,
                body: who?.name ? `From ${who.name}` : 'A payment has come in',
                url: '/admin',
                kind: 'billing',
              }).catch(() => {});

              for (const admin of admins) {
                try {
                  await sendAdminPaymentEmail(admin.email, {
                    customerName: who?.name,
                    customerEmail: who?.email,
                    amount: money,
                    kind: invoice.metadata?.planChangeRequestId ? 'plan_change' : 'subscription',
                    description: invoice.description || invoice.lines?.data?.[0]?.description || null,
                    invoiceUrl: invoice.hosted_invoice_url || null,
                    adminUrl: `${appOrigin()}/admin`,
                  });
                } catch (err) {
                  console.error(`Recorded the payment but could not tell ${admin.email}`, err.message);
                }
              }
            }
          } catch (err) {
            // Same rule as the bookkeeping above: an email is never a reason
            // to make Stripe retry a webhook that otherwise worked.
            console.error('Could not send the payment notification', err.message);
          }

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

        // The rest applies only to an invoice an administrator raised for a
        // plan change. A renewal carries no request id and is finished here.
        const requestId = Number(invoice.metadata?.planChangeRequestId);
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

        // The plan is deliberately NOT moved here.
        //
        // A one-off invoice says what was paid; it says nothing about the dates
        // the new plan should run between, and those are the part somebody has
        // to decide. Moving plan_type automatically produced an account on the
        // new plan with the old plan's period still attached — right entitlement,
        // wrong end date, and no record of who chose it. So the money arriving
        // is announced on the ticket and in the queue, and an administrator
        // applies the change with the dates they mean.

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

        // Said on the ticket itself, which is where the request was made and
        // where whoever picks it up is already looking. A notification can be
        // missed; the thread is the record.
        try {
          const [linked] = await pool.execute(
            'SELECT id, status FROM support_tickets WHERE plan_change_request_id = ? LIMIT 1',
            [requestId]
          );
          if (linked[0]) {
            const amount = ((invoice.amount_paid ?? 0) / 100).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
            // What the customer reads.
            //
            // This used to carry "the plan itself still has to be applied by
            // hand, with the dates it should run between" — an instruction to
            // us, on a thread the person who paid can read. Telling a customer
            // their payment has landed and then that somebody still has to do
            // something about it invites the one question the message was
            // meant to prevent.
            await pool.execute(
              `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
               VALUES (?, NULL, 'system', 'Taxify', ?)`,
              [
                linked[0].id,
                `Payment of ${(invoice.currency || 'aud').toUpperCase()} ${amount} received, with thanks. ` +
                  `We are moving you to ${label} now and will confirm here as soon as it is done. Your receipt is ` +
                  'on your billing page.',
              ]
            );

            // And what the team needs, where only the team sees it.
            await pool.execute(
              `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
               VALUES (?, NULL, 'note', 'Taxify', ?)`,
              [
                linked[0].id,
                `Paid in full. Apply ${label} on their account with the dates it should run between — nothing here ` +
                  'moves the plan, and the customer has been told it is being done.',
              ]
            );
            // Back into the queue. Somebody has to act on this, and a ticket
            // sitting in "awaiting customer" is a ticket nobody is looking at.
            await pool.execute(
              `UPDATE support_tickets
                  SET status = 'awaiting_support', last_message_at = NOW(), support_read_at = NULL
                WHERE id = ?`,
              [linked[0].id]
            );
          }
        } catch (err) {
          console.error('Could not post the payment onto the support ticket', err);
        }

        try {
          await notify(request.user_id, {
            title: `Payment received for ${label}`,
            body: 'Thank you — your payment came through. We will move you across shortly and the invoice is on your billing page.',
            url: '/account?tab=billing',
            kind: 'billing',
          });
          await notifyAdmins({
            title: `${who[0]?.name || who[0]?.email || 'A customer'} paid for ${label}`,
            body: 'The money has arrived. Apply the plan on their account with the dates it should run between.',
            url: '/admin?tab=support',
            kind: 'billing',
          });
        } catch (err) {
          // The money has already arrived and the request is already marked
          // paid. Failing the webhook here would make Stripe retry a payment
          // that was fully handled.
          console.error('Could not send plan-change notifications', err);
        }
        break;
      }
      // The invoice was withdrawn in Stripe rather than paid.
      //
      // Voided means we took it back; uncollectible means it was written off.
      // Either way the plan change is not happening on that invoice, and the
      // ticket was the last place to say so — before this the request sat as
      // "invoiced" for ever, the customer's panel kept offering a payment link
      // that no longer worked, and nothing in the app knew the difference.
      case 'invoice.voided':
      case 'invoice.marked_uncollectible': {
        const invoice = event.data.object;
        const requestId = Number(invoice.metadata?.planChangeRequestId);
        if (!requestId) break;

        const [rows] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [requestId]);
        const request = rows[0];
        // A paid request is never unwound by this. Stripe can void a credit
        // note against an invoice that was paid, and treating that as "the
        // plan change is off" would take away something already bought.
        if (!request || request.status === 'paid') break;

        await pool.execute(
          `UPDATE plan_change_requests
              SET status = 'cancelled', voided_at = NOW(), cancelled_at = COALESCE(cancelled_at, NOW()),
                  updated_at = NOW()
            WHERE id = ?`,
          [requestId]
        );

        try {
          const [linked] = await pool.execute(
            'SELECT id FROM support_tickets WHERE plan_change_request_id = ? LIMIT 1',
            [requestId]
          );
          if (linked[0]) {
            await pool.execute(
              `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
               VALUES (?, NULL, 'system', 'Taxify', ?)`,
              [
                linked[0].id,
                'This invoice has been withdrawn — please ignore it. Nothing has been charged and your plan is ' +
                  'unchanged. Reply here if you would still like to move and we will raise a new one.',
              ]
            );
            await pool.execute(
              `UPDATE support_tickets
                  SET status = 'awaiting_support', last_message_at = NOW(), support_read_at = NULL
                WHERE id = ?`,
              [linked[0].id]
            );
          }
          await notify(request.user_id, {
            title: 'Your plan change invoice was withdrawn',
            body: 'There is nothing to pay and your plan is unchanged. The ticket explains it.',
            url: '/account?tab=billing',
            kind: 'billing',
          });
        } catch (err) {
          console.error('Could not record the withdrawn invoice', err);
        }
        break;
      }
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = Number(session.client_reference_id || session.metadata?.userId);
        // Paid outright: there is no subscription object, so the year is
        // granted here rather than read off one. Access already runs on
        // subscription_current_period_end, so a paid year and a subscribed year
        // are the same thing to everything downstream — the only difference is
        // that nothing renews this one, and stripe_subscription_id staying null
        // is how the rest of the app knows to say "ends" rather than "renews".
        if (userId && session.mode === 'payment') {
          const planType = session.metadata?.planType === 'business' ? 'business' : 'individual';
          const endsAt = new Date();
          endsAt.setFullYear(endsAt.getFullYear() + 1);

          if (session.metadata?.promoCode) {
            await pool
              .execute('UPDATE users SET promo_redeemed_at = NOW() WHERE id = ? AND promo_redeemed_at IS NULL', [userId])
              .catch((err) => console.error('Could not mark the promo redeemed', err));
          }

          await pool.execute(
            `UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = NULL,
             subscription_status = 'active', plan_type = ?, subscription_current_period_end = ?
           WHERE id = ?`,
            [session.customer || null, planType, endsAt, userId]
          );
          break;
        }

        if (userId) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          // They may have switched plan at checkout, so the plan recorded here
          // is the one that was actually paid for.
          const planType = session.metadata?.planType === 'business' ? 'business' : 'individual';

          // The promo is spent now, not when checkout opened. An abandoned
          // session must not burn somebody's discount.
          if (session.metadata?.promoCode) {
            await pool
              .execute('UPDATE users SET promo_redeemed_at = NOW() WHERE id = ? AND promo_redeemed_at IS NULL', [userId])
              .catch((err) => console.error('Could not mark the promo redeemed', err));
          }
          // Always written here, never preserved: this is a checkout that has
          // just completed, so the subscription is live by definition and an
          // old end date can only be in the past.
          await pool.execute(
            `UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = 'active',
             plan_type = ?, subscription_current_period_end = FROM_UNIXTIME(?)
           WHERE id = ?`,
            [
              session.customer,
              subscription.id,
              planType,
              // current_period_end moved onto the subscription item in
              // Stripe's 2025 API versions. Read from both, or a newer
              // account writes a null period end here.
              subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end || null,
              userId,
            ]
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

        // current_period_end moved onto the subscription item in Stripe's 2025
        // API versions. Read from both, and never overwrite a good date with a
        // null — a renewal that arrives without one must not wipe the end date
        // it was extending.
        const periodEnd = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end || null;

        const ends = periodEndFor(status, periodEnd);
        const endsSql = ends.keepOld ? 'subscription_current_period_end' : 'FROM_UNIXTIME(?)';
        const endsArgs = ends.keepOld ? [] : [ends.value];

        await pool.execute(
          `UPDATE users
              SET subscription_status = ?, subscription_current_period_end = ${endsSql}
                  ${planFromPrice ? ', plan_type = ?' : ''}
            WHERE stripe_customer_id = ?`,
          planFromPrice
            ? [status, ...endsArgs, planFromPrice, subscription.customer]
            : [status, ...endsArgs, subscription.customer]
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
