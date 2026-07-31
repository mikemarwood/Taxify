import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { userRootDir } from '../lib/receiptStorage.js';
import { normalisePromoCode, isValidPromoCodeFormat } from '../lib/promoCodes.js';
import pool, { getSetting, setSetting, getMfaMode } from '../db.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toTitleCase } from '../lib/text.js';
import { getSmtpConfig, saveSmtpConfig, sendTestEmail, diagnoseSmtp, sendAdminCreatedAccountEmail } from '../lib/mailer.js';
import { getStripeAdminSettings, saveStripeAdminSettings, getStripeSecretKeyForMode } from '../lib/stripe.js';
import { hashPassword } from '../auth/password.js';
import { generateActivationToken } from '../auth/activationToken.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';
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
              (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id) AS expense_count
       FROM users u
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
        // Everything this user has uploaded — receipts and property documents
        // both live under <uploads>/<id>.
        storageBytes: directorySize(userRootDir(uploadsDir, u.id)),
      })),
    });
  })
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const { name, email, planType } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email is required' });
    if (planType !== undefined && planType !== 'individual' && planType !== 'family') {
      return res.status(400).json({ error: "planType must be 'individual' or 'family'" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const finalPlanType = planType === 'family' ? 'family' : 'individual';
    const placeholderHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const { token, tokenHash, expiresAt } = generateActivationToken();

    let userId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO users (email, password_hash, name, role, plan_type, activation_token_hash, activation_token_expires_at)
         VALUES (?, ?, ?, 'owner', ?, ?, ?)`,
        [normalizedEmail, placeholderHash, String(name).trim(), finalPlanType, tokenHash, expiresAt]
      );
      userId = result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      throw err;
    }

    await seedDefaultCategories(pool, userId);

    const acceptUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${token}`;
    try {
      await sendAdminCreatedAccountEmail(normalizedEmail, String(name).trim(), acceptUrl);
    } catch (err) {
      console.error('Failed to send admin-created-account email', err);
    }

    res.status(201).json({
      user: { id: userId, name: String(name).trim(), email: normalizedEmail, planType: finalPlanType, active: false },
      acceptUrl,
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

    const [rows] = await pool.execute('SELECT id, email, is_admin FROM users WHERE id = ?', [targetId]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.is_admin) {
      return res.status(400).json({ error: 'Administrator accounts can’t be deleted here — remove admin first' });
    }

    // Sub-users and accountants hang off this account; they go with it, since
    // an invited login with no account holder can't reach anything anyway.
    const [dependents] = await pool.execute('SELECT id FROM users WHERE account_holder_id = ?', [targetId]);

    await pool.execute('DELETE FROM users WHERE id = ?', [targetId]);

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

// --- Promo codes ---------------------------------------------------------

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
    planType: body?.planType === 'individual' || body?.planType === 'family' ? body.planType : null,
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

router.delete(
  '/default-categories/:id',
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM default_categories WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Default category not found' });
    res.json({ ok: true });
  })
);

export default router;
