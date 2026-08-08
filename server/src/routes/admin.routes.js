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
import { getStripe } from '../lib/stripe.js';
import { amountProblem, canTransition } from '../lib/planRequests.js';
import { shapeTicket, messagesFor, addReply, ticketUrl, upload, editMessage } from './support.routes.js';
import { categoryLabel } from '../lib/support.js';
import { removeTicketFiles, MAX_ATTACHMENTS_PER_MESSAGE } from '../lib/supportAttachments.js';
import { publicOrigin } from '../lib/publicOrigin.js';
import { sendSupportClosedEmail } from '../lib/mailer.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toTitleCase } from '../lib/text.js';
import {
  getSmtpConfig,
  saveSmtpConfig,
  sendTestEmail,
  diagnoseSmtp,
  sendAdminCreatedAccountEmail,
  sendAccountantAccessEndedEmail,
} from '../lib/mailer.js';
import { getStripeAdminSettings, saveStripeAdminSettings, getStripeSecretKeyForMode } from '../lib/stripe.js';
import { hashPassword } from '../auth/password.js';
import { generateActivationToken } from '../auth/activationToken.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';
import { ensureDefaultEntity } from '../lib/entities.js';
import { isFinancialYearLabel } from '../lib/financialYear.js';
import { notify, verifyFcm } from '../lib/notify.js';
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
router.use(requireAuth, requireAdmin);

const PALETTE = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#a1a1aa', '#ef4444', '#eab308', '#14b8a6'];

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.is_admin, u.avatar_path, u.created_at, u.activated_at,
              u.access_bypass, u.access_bypass_until, u.subscription_status, u.trial_ends_at,
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
        createdAt: u.created_at,
        active: !!u.activated_at,
        expenseCount: u.expense_count,
        subscriptionStatus: u.subscription_status,
        trialEndsAt: u.trial_ends_at,
        accessBypass: !!u.access_bypass,
        accessBypassUntil: u.access_bypass_until,
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
    const { isAdmin } = req.body || {};
    if (typeof isAdmin !== 'boolean') return res.status(400).json({ error: 'isAdmin must be a boolean' });

    if (targetId === req.user.id) {
      return res.status(400).json({ error: "You can't change your own admin status" });
    }

    const [result] = await pool.execute('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin ? 1 : 0, targetId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
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
    const { registrationEnabled, mfaMode } = req.body || {};
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
  for (const field of ['publishableKey', 'secretKey', 'webhookSecret', 'priceIndividual', 'priceFamily']) {
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
    const amount = Number(req.body?.amount);
    const badAmount = amountProblem(req.body?.amount);
    if (badAmount) return res.status(400).json({ error: badAmount });

    const description = String(req.body?.description || '').trim().slice(0, 300);
    const daysUntilDue = Math.min(90, Math.max(1, Number(req.body?.daysUntilDue) || 14));

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

    const currency = (req.body?.currency || 'aud').toLowerCase();
    const line = description || `Taxify — change to the ${request.to_plan === 'business' ? 'Small Business' : 'Individual'} plan`;

    // The invoice is created empty, then the item is attached to it by id.
    // Creating the item first and letting it attach itself to "the customer's
    // next invoice" is how a pending item from an abandoned attempt ends up on
    // somebody's subscription renewal.
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: daysUntilDue,
      description: line,
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
              invoice_currency = ?, invoiced_at = NOW(), invoiced_by = ?, updated_at = NOW()
        WHERE id = ?`,
      [sent.id, sent.hosted_invoice_url || null, Math.round(amount * 100), currency, req.user.id, request.id]
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

router.delete(
  '/plan-requests/:id',
  asyncHandler(async (req, res) => {
    // Deliberately does not void anything in Stripe. An invoice that has been
    // sent is a document somebody has received, and withdrawing it is a
    // decision to make in Stripe with the rest of the billing record.
    const [result] = await pool.execute(
      `UPDATE plan_change_requests SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = ? AND status IN ('pending', 'invoiced')`,
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  })
);


// ---------------------------------------------------------------------------
// Support tickets, from the other side of the conversation.
// ---------------------------------------------------------------------------

router.get(
  '/support/tickets',
  asyncHandler(async (req, res) => {
    // Anything needing a reply first, oldest first within that — somebody who
    // has been waiting two days should not sit below somebody who wrote in five
    // minutes ago.
    const [rows] = await pool.query(
      `SELECT t.*, u.name, u.email, u.avatar_path
         FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
        ORDER BY FIELD(t.status, 'awaiting_support', 'awaiting_customer', 'closed'),
                 t.last_message_at ASC
        LIMIT 200`
    );
    res.json({ tickets: rows.map((r) => shapeTicket(r, { includeEmail: true })) });
  })
);

router.get(
  '/support/tickets/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email, u.avatar_path
         FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    // Opening it counts as reading it, which is what takes it off the badge.
    // The status is untouched: it still needs a reply, and only replying
    // changes that.
    await pool.execute('UPDATE support_tickets SET support_read_at = NOW() WHERE id = ?', [rows[0].id]);

    // The plan change this ticket is about, if it is about one. Sent with the
    // thread so the invoice can be raised from inside the conversation rather
    // than from a second screen that has to be kept in step with it.
    let planRequest = null;
    if (rows[0].plan_change_request_id) {
      const [pr] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [
        rows[0].plan_change_request_id,
      ]);
      if (pr[0]) {
        planRequest = {
          id: pr[0].id,
          toPlan: pr[0].to_plan,
          fromPlan: pr[0].from_plan,
          status: pr[0].status,
          invoiceUrl: pr[0].invoice_url,
          invoiceAmountCents: pr[0].invoice_amount_cents,
          invoiceCurrency: pr[0].invoice_currency,
          paidAt: pr[0].paid_at,
        };
      }
    }

    res.json({
      ticket: shapeTicket(rows[0], { includeEmail: true }),
      messages: await messagesFor(rows[0].id),
      planRequest,
    });
  })
);

router.post(
  '/support/tickets/:id/reply',
  // Without this, a reply carrying an image arrives as an unparsed multipart
  // body: req.body is empty, the message reads as blank, and the reply is
  // refused with "write a message first" while the message sits on screen.
  upload.array('attachments', MAX_ATTACHMENTS_PER_MESSAGE),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return addReply(req, res, rows[0], 'support');
  })
);

// Closing, and opening again. Only support can do either: a customer closing
// their own ticket is a different feature, and one nobody has asked for.
router.post(
  '/support/tickets/:id/status',
  asyncHandler(async (req, res) => {
    const closing = req.body?.status === 'closed';

    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      [req.params.id]
    );
    const ticket = rows[0];
    if (!ticket) return res.status(404).json({ error: 'Not found' });

    if (closing) {
      await pool.execute(
        `UPDATE support_tickets SET status = 'closed', closed_at = NOW(), closed_by = ?, updated_at = NOW()
          WHERE id = ?`,
        [req.user.id, ticket.id]
      );
    } else {
      // Back to needing a reply from us, not from them: whoever reopened it did
      // so because something was left undone at our end.
      await pool.execute(
        `UPDATE support_tickets SET status = 'awaiting_support', closed_at = NULL, closed_by = NULL,
           updated_at = NOW() WHERE id = ?`,
        [ticket.id]
      );
    }

    // Written into the thread so the conversation explains itself later, rather
    // than a reply appearing after a gap with nothing saying why.
    await pool.execute(
      `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
       VALUES (?, ?, 'system', ?, ?)`,
      [
        ticket.id,
        req.user.id,
        req.user.name || 'Support',
        closing ? 'Ticket closed.' : 'Ticket opened again.',
      ]
    );

    if (closing) {
      try {
        const to = ticket.user_id ? ticket.email : ticket.guest_email;
        const name = ticket.user_id ? ticket.name : ticket.guest_name;
        // A guest reads through their emailed link, which is the only address
        // they have — and the token is hashed here, so the email points at the
        // ticket page and asks them to use the link they already have.
        if (to) {
          await sendSupportClosedEmail(to, name, {
            reference: ticket.reference,
            subject: ticket.subject,
            category: categoryLabel(ticket.category),
            url: ticket.user_id ? ticketUrl(ticket) : `${publicOrigin()}/support`,
          });
        }
      } catch (err) {
        console.error('Could not send the ticket-closed email', err);
      }
    }

    res.json({ ok: true, messages: await messagesFor(ticket.id) });
  })
);

// Support editing its own reply. Same rule as the customer's side: your own
// message only, and never once the ticket is closed.
router.patch(
  '/support/messages/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT m.*, t.status, t.id AS ticket_id FROM support_messages m
         JOIN support_tickets t ON t.id = m.ticket_id WHERE m.id = ?`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row || row.author_user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    return editMessage(req, res, row, { id: row.ticket_id, status: row.status });
  })
);

// Deleting a conversation, and everything it holds.
//
// The rows go by cascade; the files do not, so they are removed here. Order
// matters: files first, then the row. A row deleted before its files leaves
// nothing pointing at them, and they sit on disk forever with no way left to
// know which ticket they belonged to.
router.delete(
  '/support/tickets/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT id FROM support_tickets WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    try {
      removeTicketFiles(uploadsDir, rows[0].id);
    } catch (err) {
      // Said out loud rather than swallowed: the row is about to go, so this is
      // the last moment anybody could connect these files to anything.
      console.error(`Could not remove attachments for ticket ${rows[0].id}`, err);
    }

    await pool.execute('DELETE FROM support_tickets WHERE id = ?', [rows[0].id]);
    res.json({ ok: true });
  })
);

export default router;
