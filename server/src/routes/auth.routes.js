import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool, { getSetting, getMfaMode } from '../db.js';
import { hashPassword, verifyPassword, isStrongPassword } from '../auth/password.js';
import { signToken, cookieOptions, COOKIE_NAME } from '../auth/jwt.js';
import { requireAuth, requireAccountOwner } from '../auth/middleware.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { generateOtp, hashOtp, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS, OTP_LOCKOUT_MINUTES } from '../auth/otp.js';
import { toPublicUser } from '../auth/publicUser.js';
import { computeAccessLocked } from '../auth/access.js';
import { sendOtpEmail, sendActivationEmail, sendInviteEmail } from '../lib/mailer.js';
import { tenantAvatarsDir } from '../tenant/uploads.js';

const ACTIVATION_TOKEN_DAYS = 5;
const TRIAL_DAYS = 14;

function generateActivationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tenantAvatarsDir()),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_AVATAR_MIME.has(file.mimetype)) return cb(new Error('Unsupported file type'));
    cb(null, true);
  },
});

const router = Router();

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const registrationEnabled = await getSetting('registration_enabled');
    if (registrationEnabled === 'false') {
      return res.status(403).json({ error: 'Registrations are currently closed' });
    }

    const { email, password, name, planType } = req.body || {};

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number',
      });
    }
    const finalPlanType = planType === 'family' ? 'family' : 'individual';

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);
    const mfaMode = await getMfaMode();
    const otpEnabledAtSignup = mfaMode === 'required' ? 1 : 0;
    const { token, tokenHash, expiresAt } = generateActivationToken();

    let userId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO users (email, password_hash, name, otp_enabled, otp_prompted, role, plan_type, activation_token_hash, activation_token_expires_at)
         VALUES (?, ?, ?, ?, 0, 'owner', ?, ?, ?)`,
        [normalizedEmail, passwordHash, String(name).trim(), otpEnabledAtSignup, finalPlanType, tokenHash, expiresAt]
      );
      userId = result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      throw err;
    }

    await seedDefaultCategories(pool, userId);

    const activationUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/activate?token=${token}`;
    try {
      await sendActivationEmail(normalizedEmail, String(name).trim(), activationUrl);
    } catch (err) {
      console.error('Failed to send activation email', err);
    }

    res.status(201).json({ pendingActivation: true, email: normalizedEmail });
  })
);

router.get(
  '/activate',
  asyncHandler(async (req, res) => {
    const { token } = req.query || {};
    if (!token) return res.status(400).json({ error: 'Activation token is required' });

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE activation_token_hash = ? AND activated_at IS NULL',
      [tokenHash]
    );
    const user = rows[0];
    if (!user || new Date(user.activation_token_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This activation link is invalid or has expired.' });
    }

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await pool.execute(
      `UPDATE users SET activated_at = NOW(), activation_token_hash = NULL, activation_token_expires_at = NULL,
       trial_ends_at = ?, subscription_status = 'trialing' WHERE id = ?`,
      [trialEndsAt, user.id]
    );

    const token2 = signToken(user);
    res.cookie(COOKIE_NAME, token2, cookieOptions());
    const mfaMode = await getMfaMode();
    user.trial_ends_at = trialEndsAt;
    user.subscription_status = 'trialing';
    const publicUser = toPublicUser(user, mfaMode);
    publicUser.accessLocked = false;
    res.json({ user: publicUser });
  })
);

router.post(
  '/resend-activation',
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? AND activated_at IS NULL', [normalizedEmail]);
    const user = rows[0];
    // Always respond the same way whether or not the account exists, so this
    // endpoint can't be used to probe which emails are registered.
    if (!user) return res.json({ ok: true });

    const issuedAt = new Date(new Date(user.activation_token_expires_at).getTime() - ACTIVATION_TOKEN_DAYS * 24 * 60 * 60 * 1000);
    if (user.activation_token_expires_at && Date.now() - issuedAt.getTime() < 60 * 1000) {
      return res.json({ ok: true });
    }

    const { token, tokenHash, expiresAt } = generateActivationToken();
    await pool.execute('UPDATE users SET activation_token_hash = ?, activation_token_expires_at = ? WHERE id = ?', [
      tokenHash,
      expiresAt,
      user.id,
    ]);

    const activationUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/activate?token=${token}`;
    try {
      await sendActivationEmail(user.email, user.name, activationUrl);
    } catch (err) {
      console.error('Failed to send activation email', err);
    }

    res.json({ ok: true });
  })
);

router.post(
  '/invite',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const { name, email, role } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email is required' });
    if (role !== 'sub_user' && role !== 'accountant') {
      return res.status(400).json({ error: 'role must be sub_user or accountant' });
    }

    const [existingRows] = await pool.execute('SELECT id FROM users WHERE account_holder_id = ? AND role = ?', [
      req.user.id,
      role,
    ]);
    if (existingRows.length > 0) {
      return res.status(400).json({
        error: role === 'accountant' ? 'You already have an accountant invited' : 'You already have a family member invited',
      });
    }
    if (role === 'sub_user' && req.user.planType !== 'family') {
      return res.status(400).json({ error: 'Upgrade to the Family plan to add a second user' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const placeholderHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const { token, tokenHash, expiresAt } = generateActivationToken();

    let userId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO users (email, password_hash, name, role, account_holder_id, activation_token_hash, activation_token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [normalizedEmail, placeholderHash, String(name).trim(), role, req.user.id, tokenHash, expiresAt]
      );
      userId = result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      throw err;
    }

    if (role === 'sub_user') {
      await seedDefaultCategories(pool, userId);
    }

    const acceptUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${token}`;
    try {
      await sendInviteEmail(normalizedEmail, String(name).trim(), role, acceptUrl, req.user.name);
    } catch (err) {
      console.error('Failed to send invite email', err);
    }

    res.status(201).json({ ok: true });
  })
);

router.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE activation_token_hash = ? AND activated_at IS NULL',
      [tokenHash]
    );
    const user = rows[0];
    if (!user || new Date(user.activation_token_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invitation link is invalid or has expired.' });
    }

    await pool.execute(
      `UPDATE users SET password_hash = ?, activated_at = NOW(), activation_token_hash = NULL, activation_token_expires_at = NULL
       WHERE id = ?`,
      [hashPassword(password), user.id]
    );

    const jwt = signToken(user);
    res.cookie(COOKIE_NAME, jwt, cookieOptions());
    const mfaMode = await getMfaMode();
    const publicUser = toPublicUser(user, mfaMode);
    publicUser.accessLocked = await computeAccessLocked(publicUser);
    res.json({ user: publicUser });
  })
);

router.get(
  '/family',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, activated_at FROM users WHERE account_holder_id = ? ORDER BY role, name',
      [req.user.id]
    );
    res.json({
      members: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        active: !!r.activated_at,
      })),
    });
  })
);

router.delete(
  '/family/:id',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM users WHERE id = ? AND account_holder_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password, publicDevice } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.activated_at) {
      return res.status(403).json({
        error: 'Please activate your account first — check your email for the activation link.',
        notActivated: true,
      });
    }

    if (user.otp_locked_until && new Date(user.otp_locked_until) > new Date()) {
      return res.status(423).json({
        error: 'Too many incorrect codes. Login is temporarily locked.',
        lockedUntil: user.otp_locked_until,
      });
    }

    const mfaMode = await getMfaMode();
    const mfaRequiredForUser = mfaMode === 'required' || !!user.otp_enabled;

    if (!mfaRequiredForUser) {
      const token = signToken(user);
      res.cookie(COOKIE_NAME, token, cookieOptions(!publicDevice));
      const publicUser = toPublicUser(user, mfaMode);
      publicUser.accessLocked = await computeAccessLocked(publicUser);
      return res.json({ otpRequired: false, user: publicUser });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await pool.execute(
      'UPDATE users SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?',
      [hashOtp(code), expiresAt, user.id]
    );

    try {
      await sendOtpEmail(user.email, user.name, code, OTP_TTL_MINUTES);
    } catch (err) {
      console.error('Failed to send OTP email', err);
      await pool.execute('UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?', [user.id]);
      return res.status(500).json({ error: 'Could not send your login code. Please try again shortly.' });
    }

    res.json({ otpRequired: true, userId: user.id, expiresAt, publicDevice: !!publicDevice });
  })
);

router.post(
  '/otp/verify',
  asyncHandler(async (req, res) => {
    const { userId, code, publicDevice } = req.body || {};
    if (!userId || !code) return res.status(400).json({ error: 'Code is required' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid request' });

    if (user.otp_locked_until && new Date(user.otp_locked_until) > new Date()) {
      return res.status(423).json({
        error: 'Too many incorrect codes. Login is temporarily locked.',
        lockedUntil: user.otp_locked_until,
      });
    }

    if (!user.otp_code || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'That code has expired. Please log in again to get a new one.' });
    }

    if (hashOtp(String(code)) !== user.otp_code) {
      const attempts = user.otp_attempts + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000);
        await pool.execute(
          'UPDATE users SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0, otp_locked_until = ? WHERE id = ?',
          [lockedUntil, user.id]
        );
        return res.status(423).json({
          error: 'Too many incorrect codes. Login is temporarily locked.',
          lockedUntil,
        });
      }
      await pool.execute('UPDATE users SET otp_attempts = ? WHERE id = ?', [attempts, user.id]);
      return res.status(401).json({ error: 'Incorrect code', attemptsRemaining: OTP_MAX_ATTEMPTS - attempts });
    }

    await pool.execute(
      'UPDATE users SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0, otp_locked_until = NULL WHERE id = ?',
      [user.id]
    );

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOptions(!publicDevice));
    const mfaMode = await getMfaMode();
    const publicUser = toPublicUser(user, mfaMode);
    publicUser.accessLocked = await computeAccessLocked(publicUser);
    res.json({ user: publicUser });
  })
);

router.patch(
  '/otp-settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mfaMode = await getMfaMode();
    if (mfaMode === 'required') {
      return res.status(400).json({ error: 'MFA is required for every account and cannot be turned off.' });
    }
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });

    await pool.execute(
      'UPDATE users SET otp_enabled = ?, otp_last_prompted_at = NOW() WHERE id = ?',
      [enabled ? 1 : 0, req.user.id]
    );
    res.json({ ok: true, otpEnabled: enabled, mfaPromptDue: false });
  })
);

router.post(
  '/otp/dismiss-prompt',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.execute('UPDATE users SET otp_last_prompted_at = NOW() WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  })
);

router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, email } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const trimmedName = String(name).trim();

    try {
      await pool.execute('UPDATE users SET name = ?, email = ? WHERE id = ?', [trimmedName, normalizedEmail, req.user.id]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      throw err;
    }

    res.json({ user: { ...req.user, name: trimmedName, email: normalizedEmail } });
  })
);

router.patch(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: 'New password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number',
      });
    }

    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const row = rows[0];
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), req.user.id]);
    res.json({ ok: true });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post(
  '/avatar',
  requireAuth,
  avatarUpload.single('avatar'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const [rows] = await pool.execute('SELECT avatar_path FROM users WHERE id = ?', [req.user.id]);
    const previousPath = rows[0]?.avatar_path;

    await pool.execute('UPDATE users SET avatar_path = ? WHERE id = ?', [req.file.filename, req.user.id]);

    if (previousPath) {
      fs.unlink(path.join(tenantAvatarsDir(), previousPath), () => {});
    }

    res.json({ avatarUrl: `/api/auth/avatar/${req.user.id}` });
  })
);

router.get(
  '/avatar/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT avatar_path FROM users WHERE id = ?', [req.params.id]);
    const row = rows[0];
    if (!row || !row.avatar_path) return res.status(404).json({ error: 'No avatar' });
    res.sendFile(path.join(tenantAvatarsDir(), row.avatar_path));
  })
);

export default router;
