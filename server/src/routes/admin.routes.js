import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { userRootDir } from '../lib/receiptStorage.js';
import { normalisePromoCode, isValidPromoCodeFormat } from '../lib/promoCodes.js';
import pool, { getSetting, setSetting, getMfaMode } from '../db.js';
import { sendPlanChangedEmail } from '../lib/mailer.js';
import { planLabel as planLabelFor } from '../lib/planLimits.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { signViewAsToken, cookieOptions, COOKIE_NAME } from '../auth/jwt.js';
import { toPublicUser } from '../auth/publicUser.js';
import { computeAccessLocked } from '../auth/access.js';
import { collectStats } from '../lib/adminStats.js';
import { accountSummary, targetProblem, cloneAccount } from '../lib/cloneAccount.js';
import { assignAccountNumber } from '../lib/accountNumber.js';
import { getSignupPlans, getStripe, getStripeConfig, planTypeForPriceId, REQUIRED_WEBHOOK_EVENTS } from '../lib/stripe.js';
import { canTransition } from '../lib/planRequests.js';
import { publicOrigin } from '../lib/publicOrigin.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toTitleCase } from '../lib/text.js';
import {
  getSmtpConfig,
  saveSmtpConfig,
  sendTestEmail,
  diagnoseSmtp,
  sendAccountantAccessEndedEmail,
} from '../lib/mailer.js';
import { getStripeAdminSettings, saveStripeAdminSettings, getStripeSecretKeyForMode } from '../lib/stripe.js';
import { isFinancialYearLabel } from '../lib/financialYear.js';
import { notify, notifyAdmins, verifyFcm } from '../lib/notify.js';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// Walked rather than cached: the user list is an admin screen loaded now and
// then, not a hot path, and a stored total would drift every time a receipt
// was added or deleted. Returns 0 for a user who has never uploaded anything.
function directorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(full);
      continue;
    }
    try {
      total += fs.statSync(full).size;
    } catch {
      // vanished mid-walk — skip it
    }
  }
  return total;
}

const router = Router();

// A capital at the start of every sentence, so a line typed in a hurry does not
// arrive on somebody's invoice in lower case. Only the first letter after a
// full stop, question mark or exclamation is touched — the rest is left exactly
// as it was typed, because "GST" and "ATO" are not spelling mistakes.
function sentenceCase(text) {
  return String(text || '').replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
}

router.use(requireAuth, requireAdmin);

const PALETTE = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#a1a1aa', '#ef4444', '#eab308', '#14b8a6'];

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.is_admin, u.is_support, u.avatar_path, u.created_at, u.activated_at,
              u.access_bypass, u.access_bypass_until, u.subscription_status, u.trial_ends_at,
              -- The filters read the date as well as the status, because the
              -- status only moves when something happens. Without this an
              -- account that has paid reads as having no end date, which the
              -- Active filter takes as "runs for ever" — right by accident
              -- today, wrong the moment somebody lapses.
              u.subscription_current_period_end,
              u.role, u.account_holder_id, holder.name AS holder_name,
              (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id) AS expense_count
       FROM users u
       LEFT JOIN users holder ON holder.id = u.account_holder_id
       ORDER BY u.created_at`
    );
    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isAdmin: !!u.is_admin,
        avatarUrl: u.avatar_path ? `/api/auth/avatar/${u.id}` : null,
        isSupport: Boolean(u.is_support),
        createdAt: u.created_at,
        active: !!u.activated_at,
        expenseCount: u.expense_count,
        subscriptionStatus: u.subscription_status,
        trialEndsAt: u.trial_ends_at,
        accessBypass: !!u.access_bypass,
        accessBypassUntil: u.access_bypass_until,
        subscriptionCurrentPeriodEnd: u.subscription_current_period_end,
        // Removing a family member is an administrator's job — neither of the
        // two can remove the other — so the panel has to be able to tell one
        // apart from an account holder at a glance.
        role: u.role || 'owner',
        accountHolderId: u.account_holder_id || null,
        accountHolderName: u.holder_name || null,
        // Everything this user has uploaded — receipts and property documents
        // both live under <uploads>/<id>.
        storageBytes: directorySize(userRootDir(uploadsDir, u.id)),
      })),
    });
  })
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    const { isAdmin, isSupport } = req.body || {};

    const setsAdmin = typeof isAdmin === 'boolean';
    const setsSupport = typeof isSupport === 'boolean';
    if (!setsAdmin && !setsSupport) {
      return res.status(400).json({ error: 'Nothing to change' });
    }

    // Changing your own administrator status is refused; putting yourself on
    // the support team is not. One is the ability to grant yourself everything
    // back after losing it, the other is answering tickets.
    if (setsAdmin && targetId === req.user.id) {
      return res.status(400).json({ error: "You can't change your own admin status" });
    }

    const sets = [];
    const params = [];
    if (setsAdmin) {
      sets.push('is_admin = ?');
      params.push(isAdmin ? 1 : 0);
    }
    if (setsSupport) {
      sets.push('is_support = ?');
      params.push(isSupport ? 1 : 0);
    }
    params.push(targetId);

    const [result] = await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });

    // Told, because it changes what the app looks like the next time they load
    // it — a Support section appears in their navigation with no explanation
    // otherwise.
    // Taken off the team: their open tickets go back to the queue.
    //
    // They were left assigned to somebody who can no longer open them, which is
    // worse than unassigned — the ticket looks handled, stays out of the
    // "nobody has this" list, and nothing chases it. The customer waits on a
    // person who cannot answer.
    //
    // Only the open ones. A closed ticket is the record of who dealt with it,
    // and rewriting that would be falsifying history to tidy a list.
    if (setsSupport && !isSupport) {
      const [orphaned] = await pool.execute(
        `SELECT id FROM support_tickets WHERE assigned_to = ? AND status <> 'closed'`,
        [targetId]
      );

      if (orphaned.length > 0) {
        await pool.execute(
          `UPDATE support_tickets
              SET assigned_to = NULL, assigned_at = NULL, support_read_at = NULL, updated_at = NOW()
            WHERE assigned_to = ? AND status <> 'closed'`,
          [targetId]
        );

        // Noted on each thread, so whoever picks one up can see why it came
        // back rather than assuming somebody dropped it. An internal note, not
        // a system line — the customer has no use for our staffing.
        for (const ticket of orphaned) {
          await pool
            .execute(
              `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
               VALUES (?, NULL, 'note', 'Taxify', ?)`,
              [ticket.id, 'Back in the queue — whoever had this is no longer on the support team.']
            )
            .catch((err) => console.error('Could not note the handback', err.message));
        }

        await notifyAdmins({
          title: `${orphaned.length} ticket${orphaned.length === 1 ? '' : 's'} back in the queue`,
          body: 'Somebody was taken off the support team, so what they were holding needs assigning again.',
          url: '/admin?tab=support',
          kind: 'support',
        }).catch((err) => console.error('Could not tell the admins about the handback', err.message));
      }
    }

    if (setsSupport) {
      try {
        await notify(targetId, {
          title: isSupport ? 'You are now on the support team' : 'You have been taken off the support team',
          body: isSupport
            ? 'You can read the support queue and answer any ticket assigned to you.'
            : 'You no longer have access to the support queue.',
          url: isSupport ? '/admin?tab=support' : '/',
          kind: 'support',
        });
      } catch (err) {
        console.error('Could not tell them about the support change', err);
      }
    }

    res.json({ ok: true });
  })
);

// Removes an account and everything belonging to it — expenses, categories and
// documents cascade from the foreign keys, and the uploaded files are deleted
// here since nothing in the database owns them.
//
// Admins are refused outright rather than guarded by a confirmation: an admin
// account is the one that can undo mistakes, and losing the last one locks
// everybody out of the panel permanently.
router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: "You can't delete your own account" });

    const [rows] = await pool.execute('SELECT id, email, name, is_admin FROM users WHERE id = ?', [targetId]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.is_admin) {
      return res.status(400).json({ error: 'Administrator accounts can’t be deleted here — remove admin first' });
    }

    // Sub-users hang off this account and go with it. Accountants do not —
    // their login is their own and may act for other people, so only their
    // assignment to this client disappears, by foreign key cascade.
    const [dependents] = await pool.execute('SELECT id FROM users WHERE account_holder_id = ?', [targetId]);

    // Read before the delete, because the cascade takes the assignments with
    // it. A client is about to disappear from these people's lists, and until
    // now that happened in complete silence.
    const [accountants] = await pool.execute(
      `SELECT u.email, u.name FROM accountant_assignments a
       JOIN users u ON u.id = a.accountant_user_id
       WHERE a.owner_user_id = ?`,
      [targetId]
    );

    await pool.execute('DELETE FROM users WHERE id = ?', [targetId]);

    for (const who of accountants) {
      try {
        await sendAccountantAccessEndedEmail(who.email, who.name, target.name || target.email, 'account_closed');
      } catch (err) {
        console.error(`Deleted the account but could not tell ${who.email}`, err.message);
      }
    }

    for (const id of [targetId, ...dependents.map((d) => d.id)]) {
      try {
        fs.rmSync(userRootDir(uploadsDir, id), { recursive: true, force: true });
      } catch (err) {
        console.error(`Removed user ${id} but could not delete their uploads`, err.message);
      }
    }

    console.log(`[admin] ${req.user.email} deleted account ${target.email} (${dependents.length} dependent login(s))`);
    res.json({ ok: true, deletedDependents: dependents.length });
  })
);

// Moves an account between plans. Downgrading to Individual while a second
// login exists is refused rather than silently locking that person out — the
// sub-user has to be removed first, which is a decision for the account holder.
router.patch(
  '/users/:id/plan',
  asyncHandler(async (req, res) => {
    const planType = req.body?.planType;
    if (planType !== 'individual' && planType !== 'business') {
      return res.status(400).json({ error: 'Plan must be individual or business' });
    }

    const [rows] = await pool.execute(
      'SELECT id, email, name, first_name, plan_type, role FROM users WHERE id = ?',
      [req.params.id]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role !== 'owner') {
      return res.status(400).json({ error: 'Only account holders have a plan — this login belongs to one' });
    }

    // Whether this plan is being given rather than sold. Sent together with
    // the plan because they are one decision — "put them on Small Business,
    // free, until March" is a single act, and applying it as two requests
    // leaves a window where they are billed for something they were given.
    //
    // Absent means leave the existing arrangement alone, so changing somebody's
    // plan does not silently cancel a grant made last month.
    const comp = req.body?.complimentary;
    const untilRaw = req.body?.until ? String(req.body.until).slice(0, 10) : null;
    if (untilRaw && !/^\d{4}-\d{2}-\d{2}$/.test(untilRaw)) {
      return res.status(400).json({ error: 'Enter the end date as a date, or leave it blank for open-ended' });
    }

    if (comp === undefined) {
      await pool.execute('UPDATE users SET plan_type = ? WHERE id = ?', [planType, target.id]);
    } else {
      await pool.execute(
        'UPDATE users SET plan_type = ?, access_bypass = ?, access_bypass_until = ? WHERE id = ?',
        [planType, comp ? 1 : 0, comp ? untilRaw : null, target.id]
      );
    }

    console.log(
      `[admin] ${req.user.email} moved ${target.email} from ${target.plan_type} to ${planType}` +
        (comp === undefined ? '' : comp ? ` (free${untilRaw ? ` until ${untilRaw}` : ''})` : ' (billed)')
    );

    // Only when it actually moved. Re-saving the same plan to change the
    // billing arrangement is not news worth an email.
    if (target.plan_type !== planType) {
      try {
        await sendPlanChangedEmail(target.email, target.first_name || target.name, {
          fromLabel: planLabelFor(target.plan_type),
          toLabel: planLabelFor(planType),
          complimentary: comp === true,
          until: untilRaw,
        });
      } catch (err) {
        // The change is done and recorded. A mail server being down must not
        // undo it or report it as a failure.
        console.error('Could not send the plan changed email', err.message);
      }
    }

    res.json({ ok: true, planType });
  })
);

// Signs the admin in as another account, read-only. requireAuth enforces the
// read-only part for every route at once; this only mints the token.
// Everything known about one account, on one screen. The list can then stay a
// list — the reason it was unreadable on a phone is that every fact and every
// action was crammed into a row.
router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await pool.execute(
      `SELECT u.*, holder.name AS holder_name, holder.email AS holder_email
       FROM users u LEFT JOIN users holder ON holder.id = u.account_holder_id
       WHERE u.id = ?`,
      [id]
    );
    const u = rows[0];
    if (!u) return res.status(404).json({ error: 'User not found' });

    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM expenses WHERE user_id = ? AND deleted_at IS NULL) AS expenses,
         (SELECT COUNT(*) FROM expenses WHERE user_id = ? AND deleted_at IS NOT NULL) AS in_trash,
         (SELECT COUNT(*) FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND receipt_path IS NOT NULL) AS with_receipt,
         (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE user_id = ? AND deleted_at IS NULL) AS total_amount,
         (SELECT MIN(purchase_date) FROM expenses WHERE user_id = ? AND deleted_at IS NULL) AS first_expense,
         (SELECT MAX(purchase_date) FROM expenses WHERE user_id = ? AND deleted_at IS NULL) AS last_expense,
         (SELECT MAX(created_at) FROM expenses WHERE user_id = ?) AS last_activity,
         (SELECT COUNT(*) FROM categories WHERE user_id = ?) AS categories,
         (SELECT COUNT(*) FROM category_documents WHERE user_id = ?) AS documents`,
      Array(9).fill(id)
    );

    // Everyone attached to this account, and everyone it is attached to.
    const [members] = await pool.execute(
      'SELECT id, name, email, role, activated_at FROM users WHERE account_holder_id = ? ORDER BY role, name',
      [id]
    );
    const [accountants] = await pool.execute(
      `SELECT a.id, a.financial_years, a.first_login_at, a.expires_at, u.name, u.email
       FROM accountant_assignments a JOIN users u ON u.id = a.accountant_user_id
       WHERE a.owner_user_id = ?`,
      [id]
    );
    const [clients] = await pool.execute(
      `SELECT a.id, a.expires_at, u.name, u.email
       FROM accountant_assignments a JOIN users u ON u.id = a.owner_user_id
       WHERE a.accountant_user_id = ?`,
      [id]
    );
    const [taxYears] = await pool.execute(
      `SELECT financial_year, amount, finalised_at, appointment_at FROM tax_years
       WHERE user_id = ? ORDER BY financial_year DESC`,
      [id]
    );

    // Recent sign-ins and what they came from. Twenty is enough to see a
    // pattern without turning this into a surveillance log.
    const [planChanges] = await pool.execute(
      'SELECT * FROM plan_change_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [id]
    );

    const [logins] = await pool.execute(
      'SELECT at, device, platform, browser, ip, method FROM login_events WHERE user_id = ? ORDER BY at DESC LIMIT 20',
      [id]
    );
    const [[loginSummary]] = await pool.execute(
      'SELECT COUNT(*) AS total, MIN(at) AS first_at, MAX(at) AS last_at FROM login_events WHERE user_id = ?',
      [id]
    );
    const [devices] = await pool.execute(
      `SELECT device, platform, browser, COUNT(*) AS n, MAX(at) AS last_at
       FROM login_events WHERE user_id = ?
       GROUP BY device, platform, browser ORDER BY n DESC LIMIT 8`,
      [id]
    );

    res.json({
      user: {
        id: u.id,
        name: u.name,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        pendingEmail: u.pending_email,
        phone: u.phone,
        dateOfBirth: u.date_of_birth,
        avatarUrl: u.avatar_path ? `/api/auth/avatar/${u.id}` : null,
        country: u.country,
        state: u.state,
        currency: u.currency,
        businessName: u.business_name,
        referralSource: u.referral_source,
        accountNumber: u.account_number || null,
        promoCode: u.promo_code,
        role: u.role || 'owner',
        isAdmin: !!u.is_admin,
        accountHolder: u.account_holder_id ? { id: u.account_holder_id, name: u.holder_name, email: u.holder_email } : null,
        planType: u.plan_type,
        subscriptionStatus: u.subscription_status,
        trialEndsAt: u.trial_ends_at,
        subscriptionCurrentPeriodEnd: u.subscription_current_period_end,
        stripeCustomerId: u.stripe_customer_id,
        stripeSubscriptionId: u.stripe_subscription_id,
        accessBypass: !!u.access_bypass,
        accessBypassUntil: u.access_bypass_until,
        createdAt: u.created_at,
        activatedAt: u.activated_at,
        termsAcceptedAt: u.terms_accepted_at,
        otpEnabled: !!u.otp_enabled,
        otpLockedUntil: u.otp_locked_until,
        storageBytes: directorySize(userRootDir(uploadsDir, u.id)),
      },
      stats: {
        expenses: Number(counts.expenses) || 0,
        inTrash: Number(counts.in_trash) || 0,
        withReceipt: Number(counts.with_receipt) || 0,
        totalAmount: Number(counts.total_amount) || 0,
        firstExpense: counts.first_expense,
        lastExpense: counts.last_expense,
        lastActivity: counts.last_activity,
        categories: Number(counts.categories) || 0,
        documents: Number(counts.documents) || 0,
      },
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        active: !!m.activated_at,
      })),
      accountants: accountants.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        financialYears: a.financial_years ? a.financial_years.split(',') : null,
        firstLoginAt: a.first_login_at,
        expiresAt: a.expires_at,
      })),
      clients: clients.map((c) => ({ id: c.id, name: c.name, email: c.email, expiresAt: c.expires_at })),
      taxYears: taxYears.map((t) => ({
        financialYear: t.financial_year,
        amount: t.amount === null ? null : Number(t.amount),
        finalisedAt: t.finalised_at,
        appointmentAt: t.appointment_at,
      })),
      // Every plan change ever asked for, with what became of it. The panel
      // already says which plan they are on; what it could not say is how they
      // got there, which is the question actually asked when somebody disputes
      // a charge.
      planChanges: planChanges.map((r) => ({
        id: r.id,
        fromPlan: r.from_plan,
        toPlan: r.to_plan,
        status: r.status,
        amountCents: r.invoice_amount_cents,
        currency: r.invoice_currency,
        invoiceUrl: r.invoice_url,
        askedAt: r.created_at,
        invoicedAt: r.invoiced_at,
        paidAt: r.paid_at,
      })),
      logins: {
        total: Number(loginSummary?.total) || 0,
        firstAt: loginSummary?.first_at || null,
        lastAt: loginSummary?.last_at || null,
        recent: logins.map((l) => ({
          at: l.at,
          device: l.device,
          platform: l.platform,
          browser: l.browser,
          ip: l.ip,
          method: l.method,
        })),
        devices: devices.map((d) => ({
          device: d.device,
          platform: d.platform,
          browser: d.browser,
          count: Number(d.n),
          lastAt: d.last_at,
        })),
      },
    });
  })
);

router.post(
  '/users/:id/view-as',
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: "You're already signed in as yourself" });
    if (req.user.viewedBy) return res.status(400).json({ error: 'Exit the current view first' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [targetId]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    // An account that has never opened its activation link has no password and
    // has never signed in, so there is nothing to stand in for — the session
    // would show an empty account and imply it was theirs. Refused here as
    // well as hidden in the panel, because a disabled button is a courtesy and
    // this is the actual rule.
    if (!target.activated_at) {
      return res.status(409).json({ error: 'That account has never been activated — there is nothing to view yet.' });
    }

    console.log(`[admin] ${req.user.email} started viewing as ${target.email}`);
    res.cookie(COOKIE_NAME, signViewAsToken(target, req.user.id), cookieOptions(false));

    const mfaMode = await getMfaMode();
    const publicUser = toPublicUser(target, mfaMode);
    publicUser.accessLocked = await computeAccessLocked(publicUser);
    publicUser.viewedBy = { id: req.user.id, name: req.user.name, email: req.user.email };
    publicUser.readOnly = true;
    res.json({ user: publicUser });
  })
);

// Hands an account access regardless of its subscription — a comped account, a
// support case, someone mid-way through sorting out payment. Optionally until a
// date, so it lapses on its own rather than being forgotten about.
router.patch(
  '/users/:id/access',
  asyncHandler(async (req, res) => {
    const { bypass, until } = req.body || {};
    const [rows] = await pool.execute('SELECT id, email FROM users WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    const untilDate = until ? String(until).slice(0, 10) : null;
    if (untilDate && !/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) {
      return res.status(400).json({ error: 'Enter the end date as a date, or leave it blank for open-ended' });
    }

    await pool.execute('UPDATE users SET access_bypass = ?, access_bypass_until = ? WHERE id = ?', [
      bypass ? 1 : 0,
      bypass ? untilDate : null,
      req.params.id,
    ]);

    console.log(
      `[admin] ${req.user.email} ${bypass ? 'granted' : 'revoked'} bypass access for ${rows[0].email}` +
        (bypass && untilDate ? ` until ${untilDate}` : '')
    );
    res.json({ ok: true });
  })
);

// --- Promo codes ---------------------------------------------------------

// Deduction rates, by financial year. Data rather than code because they
// change annually — a rate compiled into the app goes stale silently and then
// mis-claims for everybody at once.
router.get(
  '/tax-rates',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT id, financial_year, `key`, value, updated_at FROM tax_rates ORDER BY financial_year DESC, `key`'
    );
    res.json({
      rates: rows.map((r) => ({
        id: r.id,
        financialYear: r.financial_year,
        key: r.key,
        value: Number(r.value),
        updatedAt: r.updated_at,
      })),
    });
  })
);

const ALLOWED_RATE_KEYS = new Set(['vehicle_cents_per_km', 'vehicle_km_cap', 'home_office_per_hour']);

router.put(
  '/tax-rates',
  asyncHandler(async (req, res) => {
    const { financialYear, key, value } = req.body || {};
    if (!isFinancialYearLabel(financialYear)) return res.status(400).json({ error: 'Invalid financial year' });
    if (!ALLOWED_RATE_KEYS.has(key)) return res.status(400).json({ error: 'Unknown rate' });

    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Enter a positive number' });

    await pool.execute(
      'INSERT INTO tax_rates (financial_year, `key`, value) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()',
      [financialYear, key, amount]
    );
    console.log(`[admin] ${req.user.email} set ${key} for ${financialYear} to ${amount}`);
    res.json({ ok: true });
  })
);

router.delete(
  '/tax-rates/:id',
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM tax_rates WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Rate not found' });
    res.json({ ok: true });
  })
);

router.get(
  '/promo-codes',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM promo_codes ORDER BY active DESC, code');
    res.json({
      promoCodes: rows.map((p) => ({
        id: p.id,
        code: p.code,
        description: p.description,
        planType: p.plan_type,
        percentOff: p.percent_off === null ? null : Number(p.percent_off),
        amountOff: p.amount_off === null ? null : Number(p.amount_off),
        trialDays: p.trial_days,
        maxUses: p.max_uses,
        usedCount: p.used_count,
        active: !!p.active,
        expiresAt: p.expires_at,
      })),
    });
  })
);

function readPromoBody(body) {
  const code = normalisePromoCode(body?.code);
  if (!isValidPromoCodeFormat(code)) {
    return { error: 'Codes are 3–40 characters, upper case letters, numbers and dashes' };
  }

  const percentOff = body?.percentOff === '' || body?.percentOff == null ? null : Number(body.percentOff);
  const amountOff = body?.amountOff === '' || body?.amountOff == null ? null : Number(body.amountOff);
  if (percentOff !== null && (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100)) {
    return { error: 'Percent off must be between 1 and 100' };
  }
  if (amountOff !== null && (!Number.isFinite(amountOff) || amountOff <= 0)) {
    return { error: 'Amount off must be greater than zero' };
  }
  if (percentOff === null && amountOff === null) {
    return { error: 'Set either a percentage or an amount off' };
  }

  const maxUses = body?.maxUses === '' || body?.maxUses == null ? null : Number(body.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    return { error: 'Maximum uses must be a whole number of at least 1' };
  }

  return {
    code,
    description: body?.description ? String(body.description).trim().slice(0, 255) : null,
    planType: body?.planType === 'individual' || body?.planType === 'business' ? body.planType : null,
    percentOff,
    amountOff,
    maxUses,
    active: body?.active === false ? 0 : 1,
    expiresAt: body?.expiresAt ? String(body.expiresAt).slice(0, 10) : null,
  };
}

router.post(
  '/promo-codes',
  asyncHandler(async (req, res) => {
    const parsed = readPromoBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    try {
      await pool.execute(
        `INSERT INTO promo_codes (code, description, plan_type, percent_off, amount_off, max_uses, active, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          parsed.code,
          parsed.description,
          parsed.planType,
          parsed.percentOff,
          parsed.amountOff,
          parsed.maxUses,
          parsed.active,
          parsed.expiresAt,
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That code already exists' });
      throw err;
    }
    res.status(201).json({ ok: true });
  })
);

router.patch(
  '/promo-codes/:id',
  asyncHandler(async (req, res) => {
    // Toggling active is the common edit and shouldn't require resending the
    // whole code, so it's handled on its own.
    if (Object.keys(req.body || {}).length === 1 && typeof req.body.active === 'boolean') {
      const [result] = await pool.execute('UPDATE promo_codes SET active = ? WHERE id = ?', [
        req.body.active ? 1 : 0,
        req.params.id,
      ]);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Promo code not found' });
      return res.json({ ok: true });
    }

    const parsed = readPromoBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    try {
      const [result] = await pool.execute(
        `UPDATE promo_codes SET code = ?, description = ?, plan_type = ?, percent_off = ?, amount_off = ?,
         max_uses = ?, active = ?, expires_at = ? WHERE id = ?`,
        [
          parsed.code,
          parsed.description,
          parsed.planType,
          parsed.percentOff,
          parsed.amountOff,
          parsed.maxUses,
          parsed.active,
          parsed.expiresAt,
          req.params.id,
        ]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Promo code not found' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That code already exists' });
      throw err;
    }
    res.json({ ok: true });
  })
);

router.delete(
  '/promo-codes/:id',
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM promo_codes WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Promo code not found' });
    res.json({ ok: true });
  })
);

router.get(
  '/default-categories',
  asyncHandler(async (req, res) => {
    const [categories] = await pool.execute('SELECT id, name, color, icon FROM default_categories ORDER BY name');
    res.json({ categories });
  })
);

router.post(
  '/default-categories',
  asyncHandler(async (req, res) => {
    const { name, color, icon } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Category name is required' });

    const finalColor = color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
    try {
      const [result] = await pool.execute(
        'INSERT INTO default_categories (name, color, icon) VALUES (?, ?, ?)',
        [toTitleCase(String(name).trim()), finalColor, icon || 'tag']
      );
      const [rows] = await pool.execute('SELECT id, name, color, icon FROM default_categories WHERE id = ?', [result.insertId]);
      res.status(201).json({ category: rows[0] });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'A default category with that name already exists' });
      }
      throw err;
    }
  })
);

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const registrationEnabled = await getSetting('registration_enabled');
    const mfaMode = await getMfaMode();
    res.json({
      registrationEnabled: registrationEnabled !== 'false',
      mfaMode,
    });
  })
);

router.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    // mfaMode is deliberately ignored if sent. Two-factor is required, full
    // stop, and an endpoint that still accepted the field would be a way to
    // turn it off that nobody could see in the UI.
    const { registrationEnabled } = req.body || {};
    if (registrationEnabled !== undefined) {
      if (typeof registrationEnabled !== 'boolean') {
        return res.status(400).json({ error: 'registrationEnabled must be a boolean' });
      }
      await setSetting('registration_enabled', registrationEnabled ? 'true' : 'false');
    }
    if (mfaMode !== undefined) {
      if (mfaMode !== 'optional' && mfaMode !== 'required') {
        return res.status(400).json({ error: "mfaMode must be 'optional' or 'required'" });
      }
      await setSetting('mfa_mode', mfaMode);
    }
    res.json({ ok: true });
  })
);

router.get(
  '/email-settings',
  asyncHandler(async (req, res) => {
    const config = await getSmtpConfig();
    res.json({
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      from: config.from,
      hasPassword: !!config.password,
    });
  })
);

router.patch(
  '/email-settings',
  asyncHandler(async (req, res) => {
    const { host, port, secure, user, password, from } = req.body || {};
    if (host !== undefined && typeof host !== 'string') return res.status(400).json({ error: 'host must be a string' });
    if (port !== undefined && (!Number.isFinite(Number(port)) || Number(port) <= 0)) {
      return res.status(400).json({ error: 'port must be a positive number' });
    }
    if (secure !== undefined && typeof secure !== 'boolean') return res.status(400).json({ error: 'secure must be a boolean' });
    if (user !== undefined && typeof user !== 'string') return res.status(400).json({ error: 'user must be a string' });
    if (password !== undefined && typeof password !== 'string') return res.status(400).json({ error: 'password must be a string' });
    if (from !== undefined && typeof from !== 'string') return res.status(400).json({ error: 'from must be a string' });

    // A From of just "Taxify" reads fine in this box but leaves the envelope
    // sender with no address in it, so the relay rewrites it — mail then
    // arrives as MAILER-DAEMON and goes straight to junk. Caught here rather
    // than left to be discovered from a spam folder weeks later.
    if (from !== undefined && from.trim()) {
      const match = /<([^>]+)>/.exec(from);
      const address = (match ? match[1] : from).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) {
        return res.status(400).json({
          error:
            'The From address needs a real email address — either "you@example.com" or "Your Name <you@example.com>"',
        });
      }
    }

    await saveSmtpConfig({
      host,
      port: port !== undefined ? Number(port) : undefined,
      secure,
      user,
      password,
      from,
    });
    res.json({ ok: true });
  })
);

router.post(
  '/email-settings/test',
  asyncHandler(async (req, res) => {
    const to = (req.body && req.body.to) || req.user.email;
    try {
      await sendTestEmail(to);
      res.json({ ok: true, to });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Failed to send test email' });
    }
  })
);

// Runs the whole chain — config, connection, credentials, an actual send — and
// reports each step separately, because "it didn't arrive" has half a dozen
// causes and the send error alone rarely says which one applies.
router.post(
  '/email-settings/diagnose',
  asyncHandler(async (req, res) => {
    const to = (req.body && req.body.to) || req.user.email;
    res.json({ to, ...(await diagnoseSmtp(to)) });
  })
);

function validateSection(values, name) {
  if (values === undefined) return;
  if (typeof values !== 'object' || values === null) {
    throw Object.assign(new Error(`${name} must be an object`), { status: 400 });
  }
  for (const field of [
    'publishableKey',
    'secretKey',
    'webhookSecret',
    'priceIndividual',
    'priceBusiness',
    'priceFamily',
    'priceIndividualOnce',
    'priceBusinessOnce',
  ]) {
    if (values[field] !== undefined && typeof values[field] !== 'string') {
      throw Object.assign(new Error(`${name}.${field} must be a string`), { status: 400 });
    }
  }
}

router.get(
  '/stripe-settings',
  asyncHandler(async (req, res) => {
    const settings = await getStripeAdminSettings();
    res.json(settings);
  })
);

router.patch(
  '/stripe-settings',
  asyncHandler(async (req, res) => {
    const { mode, live, test } = req.body || {};
    if (mode !== undefined && mode !== 'live' && mode !== 'test') {
      return res.status(400).json({ error: 'mode must be "live" or "test"' });
    }
    try {
      validateSection(live, 'live');
      validateSection(test, 'test');
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    await saveStripeAdminSettings({ mode, live, test });
    res.json({ ok: true });
  })
);

router.post(
  '/stripe-settings/test',
  asyncHandler(async (req, res) => {
    const mode = req.body?.mode === 'test' ? 'test' : 'live';
    const secretKey = await getStripeSecretKeyForMode(mode);
    if (!secretKey) {
      return res.status(400).json({ error: `No secret key saved for ${mode} mode yet` });
    }
    try {
      const stripe = new Stripe(secretKey);
      await stripe.balance.retrieve();
      res.json({ ok: true, mode });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Failed to connect to Stripe' });
    }
  })
);

// Push notifications. The credential is a Firebase service-account JSON, pasted
// whole — it is the only thing Google gives you, and splitting it into fields
// here would just be a way to get one of them wrong.
router.get(
  '/push-settings',
  asyncHandler(async (req, res) => {
    const raw = await getSetting('fcm_service_account');
    let projectId = null;
    let clientEmail = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        projectId = parsed.project_id || null;
        clientEmail = parsed.client_email || null;
      } catch {
        // Stored but unreadable. Reported as configured-but-broken below rather
        // than as not configured, which would send someone looking in the wrong
        // place.
      }
    }
    const [[counts]] = await pool.query(
      'SELECT COUNT(*) AS devices, COUNT(DISTINCT user_id) AS users FROM device_tokens'
    );
    res.json({
      // Never the private key, in either direction. It is write-only.
      configured: !!raw,
      valid: !!projectId,
      projectId,
      clientEmail,
      devices: Number(counts.devices || 0),
      users: Number(counts.users || 0),
    });
  })
);

router.patch(
  '/push-settings',
  asyncHandler(async (req, res) => {
    const { serviceAccount } = req.body || {};
    if (serviceAccount === null || serviceAccount === '') {
      await setSetting('fcm_service_account', '');
      return res.json({ ok: true, configured: false });
    }
    if (typeof serviceAccount !== 'string') {
      return res.status(400).json({ error: 'serviceAccount must be the JSON file as text' });
    }
    let parsed;
    try {
      parsed = JSON.parse(serviceAccount);
    } catch {
      return res.status(400).json({ error: 'That is not valid JSON — paste the whole downloaded file' });
    }
    // Checked now rather than at 3am when the first notification silently fails.
    for (const field of ['project_id', 'client_email', 'private_key']) {
      if (typeof parsed[field] !== 'string' || !parsed[field]) {
        return res.status(400).json({ error: `The file is missing ${field} — that is not a service-account key` });
      }
    }
    if (!parsed.private_key.includes('BEGIN PRIVATE KEY')) {
      return res.status(400).json({ error: 'private_key does not look like a key — check the file copied in full' });
    }
    await setSetting('fcm_service_account', JSON.stringify(parsed));
    res.json({ ok: true, configured: true, projectId: parsed.project_id });
  })
);

// Checks the connection itself, with no phone involved. Slow enough (two calls
// to Google) that it is a button rather than something the page does on load.
router.post(
  '/push-settings/verify',
  asyncHandler(async (req, res) => {
    res.json(await verifyFcm());
  })
);

// Which devices would actually receive anything. Mostly useful for answering
// "why didn't I get it" — usually the answer is that nothing is registered.
router.get(
  '/push-settings/devices',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT d.token, d.platform, d.created_at, d.last_seen_at, u.email, u.name
       FROM device_tokens d JOIN users u ON u.id = d.user_id
       ORDER BY d.last_seen_at IS NULL, d.last_seen_at DESC LIMIT 100`
    );
    res.json({
      devices: rows.map((r) => ({
        // Enough to tell two devices apart, not enough to push from a leaked
        // log. The token is a credential for reaching someone's phone.
        token: `${r.token.slice(0, 12)}…`,
        platform: r.platform,
        email: r.email,
        name: r.name,
        registeredAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      })),
    });
  })
);

// Sends a real notification to the administrator's own devices. The only way to
// know the whole chain works is to make it carry something.
router.post(
  '/push-settings/test',
  asyncHandler(async (req, res) => {
    const result = await notify(req.user.id, {
      title: 'Taxify test notification',
      body: 'Push notifications are working.',
      kind: 'test',
    });
    const explain = {
      not_configured: 'Saved in the notification list, but not pushed — no Firebase service account has been saved.',
      no_devices: 'Saved in the notification list, but not pushed — you have not opened the Android app on a device yet.',
      no_token: 'Saved in the notification list, but Google refused the service account. Check the key is current.',
      error: 'The notification could not be recorded.',
    };
    if (!result.pushed) {
      return res.status(result.recorded ? 200 : 500).json({
        ok: result.recorded,
        delivered: 0,
        warning: explain[result.reason] || 'Nothing was delivered.',
      });
    }
    res.json({ ok: true, delivered: result.pushed });
  })
);

router.delete(
  '/default-categories/:id',
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM default_categories WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Default category not found' });
    res.json({ ok: true });
  })
);

// Editing rather than delete-and-recreate, so fixing a starter category's icon
// doesn't mean retyping it.
router.patch(
  '/default-categories/:id',
  asyncHandler(async (req, res) => {
    const { name, color, icon } = req.body || {};

    const [rows] = await pool.execute('SELECT id, name, color, icon FROM default_categories WHERE id = ?', [
      req.params.id,
    ]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Default category not found' });

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const finalName = name === undefined ? existing.name : toTitleCase(String(name).trim());
    try {
      await pool.execute('UPDATE default_categories SET name = ?, color = ?, icon = ? WHERE id = ?', [
        finalName,
        color || existing.color,
        icon || existing.icon,
        existing.id,
      ]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'A default category with that name already exists' });
      }
      throw err;
    }

    const [updated] = await pool.execute('SELECT id, name, color, icon FROM default_categories WHERE id = ?', [
      existing.id,
    ]);
    res.json({ category: updated[0] });
  })
);

// Everything the live stats page draws, in one call. One request rather than
// eight, because the page polls: eight endpoints on a timer is eight times the
// chance of a half-drawn screen where the counts disagree with the chart.
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json(await collectStats());
  })
);


// ---------------------------------------------------------------------------
// Plan changes waiting on an administrator.
// ---------------------------------------------------------------------------

router.get(
  '/plan-requests',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT r.*, u.name, u.email, u.avatar_path, u.plan_type, u.stripe_customer_id
         FROM plan_change_requests r
         JOIN users u ON u.id = r.user_id
        ORDER BY
          -- Anything still waiting on us first, oldest first within that.
          FIELD(r.status, 'pending', 'invoiced', 'paid', 'cancelled'),
          r.created_at ASC
        LIMIT 100`
    );
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: r.name,
        email: r.email,
        avatarUrl: r.avatar_path ? `/api/auth/avatar/${r.user_id}` : null,
        currentPlan: r.plan_type,
        fromPlan: r.from_plan,
        toPlan: r.to_plan,
        status: r.status,
        note: r.note,
        hasBillingAccount: Boolean(r.stripe_customer_id),
        invoiceUrl: r.invoice_url,
        invoiceAmountCents: r.invoice_amount_cents,
        invoiceCurrency: r.invoice_currency,
        invoicedAt: r.invoiced_at,
        paidAt: r.paid_at,
        createdAt: r.created_at,
      })),
    });
  })
);

// Quote it and send it. The amount is typed rather than calculated: this path
// exists precisely for the cases the price list does not cover — a part year,
// an agreed discount, two businesses at a negotiated rate.
router.post(
  '/plan-requests/:id/invoice',
  asyncHandler(async (req, res) => {
    const description = sentenceCase(String(req.body?.description || '').trim().slice(0, 300));
    // Zero is a real answer here — Stripe reads days_until_due: 0 as due on
    // receipt, which is what somebody moving plan today needs. Math.max(1, …)
    // would have quietly turned "now" into "next week".
    const requested = Number(req.body?.daysUntilDue);
    const daysUntilDue = Number.isFinite(requested) ? Math.min(90, Math.max(0, Math.round(requested))) : 14;

    const [rows] = await pool.execute(
      `SELECT r.*, u.email, u.name, u.stripe_customer_id
         FROM plan_change_requests r JOIN users u ON u.id = r.user_id
        WHERE r.id = ?`,
      [req.params.id]
    );
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Not found' });
    // The state machine decides, not a status string compared by hand — an
    // already-invoiced request being invoiced again bills somebody twice.
    if (!canTransition(request.status, 'invoiced')) {
      return res.status(409).json({ error: `That request is already ${request.status}` });
    }

    // What the plan they asked for actually costs. Read from Stripe rather
    // than typed, so the invoice and the plan cards can never disagree — and so
    // nobody is billed a figure that came from a slipped keystroke.
    const plans = await getSignupPlans();
    const target = plans.find((p) => p.planType === request.to_plan);
    if (!target?.amountPerYear) {
      return res.status(409).json({
        error: 'Stripe has no price for that plan yet, so there is nothing to invoice. Set it on the Stripe tab first.',
      });
    }
    const amount = target.amountPerYear / 100;

    const stripe = await getStripe();

    // Somebody who has never paid has no Stripe customer yet, and an invoice
    // needs one. Created here rather than at registration so an account that
    // never buys anything leaves nothing behind in Stripe.
    let customerId = request.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: request.email,
        name: request.name || undefined,
        metadata: { userId: String(request.user_id) },
      });
      customerId = customer.id;
      await pool.execute('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, request.user_id]);
    }

    const currency = (target.currency || 'aud').toLowerCase();
    const line = description || `Taxify — Change plan to ${request.to_plan === 'business' ? 'Small Business' : 'Individual'}`;

    // The invoice is created empty, then the item is attached to it by id.
    // Creating the item first and letting it attach itself to "the customer's
    // next invoice" is how a pending item from an abandoned attempt ends up on
    // somebody's subscription renewal.
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: daysUntilDue,
      description: line,
      // Says Taxify on the invoice.
      //
      // The name, logo and address in the header come from the Stripe account
      // itself, not from here — one account serves several apps, so that
      // header reads as the company rather than the product. These two are the
      // only per-invoice levers, and they at least put the product on the page
      // somebody is looking at while deciding whether they recognise the
      // charge.
      custom_fields: [{ name: 'Product', value: 'Taxify' }],
      footer: `Taxify · ${publicOrigin()}`,
      // Read back by the webhook. Without it there is no way to tell which
      // request a payment belongs to, and the plan would never move.
      metadata: {
        planChangeRequestId: String(request.id),
        userId: String(request.user_id),
        toPlan: request.to_plan,
      },
    });

    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: Math.round(amount * 100),
      currency,
      description: line,
    });

    const finalised = await stripe.invoices.finalizeInvoice(invoice.id);
    const sent = await stripe.invoices.sendInvoice(finalised.id);

    await pool.execute(
      `UPDATE plan_change_requests
          SET status = 'invoiced', stripe_invoice_id = ?, invoice_url = ?, invoice_amount_cents = ?,
              invoice_currency = ?, invoiced_at = NOW(), invoiced_by = ?,
              invoice_due_at = ?, updated_at = NOW()
        WHERE id = ?`,
      [
        sent.id,
        sent.hosted_invoice_url || null,
        Math.round(amount * 100),
        currency,
        req.user.id,
        // Stripe's own due date rather than one worked out here. Due on
        // receipt comes back without one, which is not the same as unknown —
        // it means now, and the panel reads a null as exactly that.
        sent.due_date ? new Date(sent.due_date * 1000) : null,
        request.id,
      ]
    );

    // Stripe emails the invoice itself. This is so it is waiting for them in
    // the app as well, where they asked for the change in the first place.
    try {
      await notify(request.user_id, {
        title: 'Your plan change is ready to pay',
        body: `${line} — your plan moves across as soon as it is paid.`,
        url: '/account?tab=billing',
        kind: 'billing',
      });
    } catch (err) {
      console.error('Could not notify about the plan invoice', err);
    }

    res.json({ ok: true, invoiceUrl: sent.hosted_invoice_url || null });
  })
);

// Take an invoice back and start again.
//
// A wrong invoice had no way out. The amount is read from the plan, so the
// usual reason is the wrong plan — somebody asked to move down, was invoiced
// for the move up, and the only thing available was cancelling the request
// altogether. That killed the request, made the customer ask again from the
// start, and left the invoice itself live and payable in Stripe. If they then
// paid it, the webhook took the money against a cancelled request and shouted
// about it, which is a real payment for something nobody is going to grant.
//
// This voids it properly and puts the request back to pending, so a correct
// invoice can be raised in its place from the same ticket.
// Money that has arrived, newest first.
//
// A page at a time rather than everything: this table only grows, and a
// panel that fetches every payment ever taken gets slower every week it is
// used. Twenty is what fits on a screen without scrolling past it.
// Is the webhook actually working?
//
// Not "is a secret set" — that was true throughout the outage. Three separate
// things have to hold, and each fails in a way the other two cannot see:
//
//   1. Stripe has an endpoint pointed at us.
//   2. That endpoint is subscribed to every event we act on. A missing one is
//      silent at both ends: Stripe reports success because it never sent it,
//      and we never learn what happened.
//   3. What it sends is being accepted. A rotated signing secret leaves the
//      endpoint looking perfectly healthy in Stripe while every delivery is
//      rejected, which is exactly what locked a paying customer out.
//
// (3) cannot be read from Stripe, so it is answered from our own side: the
// webhook records the last event it verified, and this reports how long ago
// that was.
router.get(
  '/stripe/webhook-health',
  asyncHandler(async (req, res) => {
    const { webhookSecret } = await getStripeConfig();
    const origin = publicOrigin();

    const last = await getSetting('stripe_webhook_last_event');
    const [lastType, lastAt] = String(last || '').split('|');

    let endpoints = [];
    let problem = null;
    try {
      const stripe = await getStripe();
      const list = await stripe.webhookEndpoints.list({ limit: 20 });
      endpoints = list.data
        .filter((e) => e.status !== 'disabled')
        .map((e) => ({
          url: e.url,
          // "*" means every event, which satisfies everything below.
          events: e.enabled_events || [],
          // Only endpoints pointing at this install matter. A test-mode or
          // staging endpoint on the same account is not evidence about us.
          ours: String(e.url || '').startsWith(origin),
        }));
    } catch (err) {
      problem = err.message;
    }

    const mine = endpoints.filter((e) => e.ours);
    const covered = new Set();
    for (const e of mine) {
      if (e.events.includes('*')) REQUIRED_WEBHOOK_EVENTS.forEach((x) => covered.add(x));
      else e.events.forEach((x) => covered.add(x));
    }
    const missing = REQUIRED_WEBHOOK_EVENTS.filter((x) => !covered.has(x));

    res.json({
      origin,
      secretSet: Boolean(webhookSecret),
      endpoints,
      matching: mine.length,
      required: REQUIRED_WEBHOOK_EVENTS,
      missing,
      lastEventType: lastType || null,
      lastEventAt: lastAt || null,
      problem,
    });
  })
);

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const perPage = 20;
    const page = Math.max(1, Math.min(999, Number(req.query?.page) || 1));

    const [[counted]] = await pool.query('SELECT COUNT(*) AS n FROM payments');
    const [rows] = await pool.query(
      `SELECT p.*, u.name, u.email, u.account_number
         FROM payments p LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.paid_at DESC, p.id DESC
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`
    );

    // What came in recently, for the figure above the list. Worked out in the
    // database rather than by adding up the page — the page is twenty rows,
    // and a total of twenty rows is not a total of anything.
    const [[week]] = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS n FROM payments
        WHERE paid_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    const [[month]] = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS n FROM payments
        WHERE paid_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    res.json({
      payments: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: r.name || null,
        email: r.email || null,
        accountNumber: r.account_number || null,
        amountCents: r.amount_cents,
        currency: r.currency,
        kind: r.kind,
        description: r.description,
        invoiceUrl: r.invoice_url,
        paidAt: r.paid_at,
      })),
      total: Number(counted.n) || 0,
      page,
      perPage,
      week: { cents: Number(week.cents) || 0, count: Number(week.n) || 0 },
      month: { cents: Number(month.cents) || 0, count: Number(month.n) || 0 },
    });
  })
);

router.post(
  '/plan-requests/:id/void',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [req.params.id]);
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Not found' });
    if (request.status !== 'invoiced') {
      return res.status(409).json({ error: `That request is ${request.status}, so there is no invoice to take back.` });
    }

    // Stripe first. If it refuses, nothing here changes — an invoice marked
    // withdrawn in our database while still open in Stripe is the exact state
    // this route exists to prevent.
    if (request.stripe_invoice_id) {
      const stripe = await getStripe();
      try {
        await stripe.invoices.voidInvoice(request.stripe_invoice_id);
      } catch (err) {
        // Already paid between the page loading and this being pressed. Said
        // plainly rather than voided-then-refunded behind somebody's back.
        if (err?.code === 'invoice_not_open' || /paid/i.test(err?.message || '')) {
          return res.status(409).json({
            error: 'Stripe says that invoice has already been paid. Refund it there before changing the plan.',
          });
        }
        return res.status(502).json({ error: `Stripe would not void it: ${err.message}` });
      }
    }

    await pool.execute(
      `UPDATE plan_change_requests
          SET status = 'pending', stripe_invoice_id = NULL, invoice_url = NULL,
              invoice_amount_cents = NULL, invoice_currency = NULL, invoiced_at = NULL,
              invoiced_by = NULL, invoice_due_at = NULL, updated_at = NOW()
        WHERE id = ?`,
      [request.id]
    );

    // On the ticket, for both sides. The customer had an invoice and a link
    // that is about to stop working; saying nothing would leave them to
    // discover that by trying to pay it.
    try {
      const [linked] = await pool.execute(
        'SELECT id FROM support_tickets WHERE plan_change_request_id = ? LIMIT 1',
        [request.id]
      );
      if (linked[0]) {
        await pool.execute(
          `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
           VALUES (?, NULL, 'system', 'Taxify', ?)`,
          [
            linked[0].id,
            'That invoice has been withdrawn — please ignore it. Nothing has been charged and your plan is ' +
              'unchanged. A corrected one is on its way.',
          ]
        );
      }
    } catch (err) {
      console.error('Could not record the withdrawn invoice on the ticket', err);
    }

    try {
      await notify(request.user_id, {
        title: 'Your invoice has been withdrawn',
        body: 'Nothing has been charged. We are sending a corrected one.',
        url: '/account?tab=billing',
        kind: 'billing',
      });
    } catch (err) {
      console.error('Could not tell them the invoice was withdrawn', err);
    }

    res.json({ ok: true });
  })
);

router.delete(
  '/plan-requests/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [req.params.id]);
    const request = rows[0];
    if (!request || !['pending', 'invoiced'].includes(request.status)) {
      return res.status(404).json({ error: 'Not found' });
    }

    // The invoice is voided with it.
    //
    // This used to leave it alone on the grounds that a sent invoice is a
    // document somebody has received. That was the wrong call: it left a live,
    // payable invoice against a request nobody was going to honour, and the
    // webhook has a branch for exactly that mess — money taken for a plan
    // change that had been called off. Cancelling the request has to mean
    // cancelling the bill, or it does not mean anything.
    //
    // A failure to void is reported rather than swallowed. Marking it
    // cancelled here while it is still open in Stripe recreates the problem.
    if (request.stripe_invoice_id) {
      const stripe = await getStripe();
      try {
        await stripe.invoices.voidInvoice(request.stripe_invoice_id);
      } catch (err) {
        if (err?.code === 'invoice_not_open' || /paid/i.test(err?.message || '')) {
          return res.status(409).json({
            error: 'Stripe says that invoice has already been paid. Refund it there first.',
          });
        }
        return res.status(502).json({ error: `Stripe would not void the invoice: ${err.message}` });
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
    res.json({ ok: true });
  })
);



// ---------------------------------------------------------------------------
// One-off tools.
//
// Blunt instruments, kept together and behind requireAdmin like everything else
// in this file, so it is obvious what they are and where they live when the day
// comes to delete them.
// ---------------------------------------------------------------------------

// Give an account the public number it never got. assignAccountNumber only runs
// at registration, so anybody who signed up before that existed has none.
// Put right every account whose payment landed but whose access did not.
//
// Subscription state reached us only by webhook, and a webhook is a promise
// from another machine. If one was delayed, rejected on a stale signing
// secret, or never switched on in the dashboard, somebody paid and stayed
// locked out — and nothing in the app would ever notice, because the only
// thing that was going to tell it had already failed to.
//
// This asks Stripe about every account we hold a customer for and writes back
// what it says. Safe to run at any time and safe to run twice: it only ever
// copies Stripe, and it reports what it changed rather than saying done.
router.post(
  '/tools/reconcile-subscriptions',
  asyncHandler(async (req, res) => {
    const stripe = await getStripe();
    const [rows] = await pool.query(
      `SELECT id, email, name, stripe_customer_id, subscription_status, plan_type,
              subscription_current_period_end
         FROM users
        WHERE stripe_customer_id IS NOT NULL AND role = 'owner'`
    );

    const fixed = [];
    const problems = [];

    for (const user of rows) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'all',
          limit: 10,
        });
        const live =
          subs.data.find((sub) => sub.status === 'active' || sub.status === 'trialing') ||
          subs.data.find((sub) => sub.status === 'past_due') ||
          null;
        if (!live) continue;

        const status = live.status === 'past_due' ? 'past_due' : 'active';
        const priceId = live.items?.data?.[0]?.price?.id || null;
        const planFromPrice = await planTypeForPriceId(priceId);
        const periodEnd = live.current_period_end || live.items?.data?.[0]?.current_period_end || null;

        // Only touched when Stripe disagrees with us, so the report is a list
        // of things that were actually wrong rather than a list of accounts.
        const endsAt = periodEnd ? new Date(periodEnd * 1000) : null;
        const same =
          user.subscription_status === status &&
          (!planFromPrice || user.plan_type === planFromPrice) &&
          (!endsAt ||
            (user.subscription_current_period_end &&
              Math.abs(new Date(user.subscription_current_period_end).getTime() - endsAt.getTime()) < 60000));
        if (same) continue;

        await pool.execute(
          `UPDATE users
              SET subscription_status = ?, stripe_subscription_id = ?,
                  plan_type = COALESCE(?, plan_type),
                  subscription_current_period_end = COALESCE(FROM_UNIXTIME(?), subscription_current_period_end)
            WHERE id = ?`,
          [status, live.id, planFromPrice, periodEnd, user.id]
        );

        fixed.push({
          id: user.id,
          email: user.email,
          name: user.name,
          was: user.subscription_status,
          now: status,
          endsAt: endsAt ? endsAt.toISOString() : null,
        });
      } catch (err) {
        // One unreachable customer must not stop the rest being put right.
        problems.push({ email: user.email, error: err.message });
      }
    }

    res.json({ checked: rows.length, fixed, problems });
  })
);

router.post(
  '/tools/account-number',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const [rows] = await pool.execute('SELECT id, email, name, account_number FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'No account with that address' });

    // Refused if they already have one. It is what somebody quotes back to
    // support and what appears on their invoices, so two numbers meaning one
    // account is worse than one account missing a number.
    if (user.account_number && req.body?.force !== true) {
      return res.status(409).json({ error: `They already have ${user.account_number}` });
    }
    if (req.body?.force === true) {
      await pool.execute('UPDATE users SET account_number = NULL WHERE id = ?', [user.id]);
    }

    const assigned = await assignAccountNumber(pool, user.id);
    res.json({ ok: true, email: user.email, before: user.account_number || null, accountNumber: assigned });
  })
);

// What is in an account, and whether it can be copied into. Looks only.
router.get(
  '/tools/account-copy/check',
  asyncHandler(async (req, res) => {
    const from = String(req.query?.from || '').trim().toLowerCase();
    const to = String(req.query?.to || '').trim().toLowerCase();

    const [users] = await pool.query(
      'SELECT id, email, name FROM users WHERE email IN (?, ?)',
      [from, to]
    );
    const source = users.find((u) => u.email === from);
    const target = users.find((u) => u.email === to);

    if (!source) return res.status(404).json({ error: `No account for ${from}` });
    if (!target) return res.status(404).json({ error: `No account for ${to}` });
    if (source.id === target.id) return res.status(400).json({ error: 'Those are the same account' });

    res.json({
      source: { email: source.email, name: source.name, summary: await accountSummary(source.id) },
      target: { email: target.email, name: target.name, summary: await accountSummary(target.id) },
      problem: await targetProblem(target.id),
    });
  })
);

router.post(
  '/tools/account-copy',
  asyncHandler(async (req, res) => {
    const from = String(req.body?.from || '').trim().toLowerCase();
    const to = String(req.body?.to || '').trim().toLowerCase();

    const [users] = await pool.query('SELECT id, email FROM users WHERE email IN (?, ?)', [from, to]);
    const source = users.find((u) => u.email === from);
    const target = users.find((u) => u.email === to);
    if (!source || !target) return res.status(404).json({ error: 'One of those accounts does not exist' });

    const result = await cloneAccount({ uploadsRoot: uploadsDir, fromUserId: source.id, toUserId: target.id });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  })
);

export default router;
