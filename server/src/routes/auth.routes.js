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
import { sendOtpEmail, sendActivationEmail, sendInviteEmail, sendAccountActivatedEmail } from '../lib/mailer.js';
import { ACTIVATION_TOKEN_DAYS, generateActivationToken } from '../auth/activationToken.js';
import { COUNTRIES, STATES, CURRENCIES, countryByName, countryByCode, isKnownCurrency, isValidState } from '../lib/geoData.js';
import { createCaptcha, verifyCaptcha } from '../lib/captcha.js';
import { getSignupPlans } from '../lib/stripe.js';
import { evaluatePromoCode, recordPromoRedemption } from '../lib/promoCodes.js';

const TRIAL_DAYS = 14;

// How long before an unactivated sign-up can ask for another email. Long
// enough to stop a stuck user hammering it, short enough not to feel punitive.
export const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const avatarsDir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

// Any image — the client crops to a PNG before upload anyway, so the only
// question is whether the browser could decode what was picked.
function isAllowedAvatar(file) {
  return typeof file.mimetype === 'string' && file.mimetype.startsWith('image/');
}
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedAvatar(file)) return cb(new Error('Only image files can be used as an avatar'));
    cb(null, true);
  },
});

const router = Router();

// --- Sign-up support -----------------------------------------------------

// Everything the sign-up form needs to render itself, in one request: the
// lists it populates dropdowns from, and a guess at the visitor's country so
// the country and currency start on something sensible.
router.get(
  '/signup-options',
  asyncHandler(async (req, res) => {
    res.json({
      countries: COUNTRIES,
      states: STATES,
      currencies: CURRENCIES,
      referralSources: REFERRAL_SOURCES,
      detectedCountry: detectCountry(req),
      trialDays: TRIAL_DAYS,
    });
  })
);

// Proxies in front of the app usually attach the country they resolved. There
// is no geo-IP database here, so when no proxy has done the work this falls
// back to the app's home market rather than guessing from the address — a
// wrong guess the visitor then has to notice and correct is worse than a
// sensible default they'd probably pick anyway.
function detectCountry(req) {
  const header =
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['x-geo-country'] ||
    req.headers['x-country-code'];
  const match = countryByCode(header);
  return match ? match.name : 'Australia';
}

router.get(
  '/captcha',
  asyncHandler(async (req, res) => {
    res.json(createCaptcha());
  })
);

// Whether an email can be registered. This does tell an anonymous caller that
// an address has an account, which is a real trade-off — but the form has to
// answer it eventually, and finding out after filling in a dozen fields is a
// worse experience than finding out as you type.
router.get(
  '/email-available',
  asyncHandler(async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      return res.json({ valid: false, available: false, reason: 'That doesn’t look like an email address' });
    }
    const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    res.json({
      valid: true,
      available: rows.length === 0,
      reason: rows.length === 0 ? null : 'An account with that email already exists',
    });
  })
);

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    res.json({ plans: await getSignupPlans(), trialDays: TRIAL_DAYS });
  })
);

router.post(
  '/promo/check',
  asyncHandler(async (req, res) => {
    const { code, planType } = req.body || {};
    const plans = await getSignupPlans();
    const plan = plans.find((p) => p.planType === planType) || plans[0];
    const result = await evaluatePromoCode(code, plan?.planType, plan?.amountPerYear);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json({ promo: result.promo, amountPerYear: plan?.amountPerYear ?? null, discountedPerYear: result.discount });
  })
);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const REFERRAL_SOURCES = [
  'Search engine',
  'Friend or colleague',
  'Social media',
  'My accountant',
  'Online advertisement',
  'Trade or industry event',
  'Mikes App Hub',
  'Other',
];

// Field limits, kept here so the messages and the database agree. Chosen per
// field rather than a blanket number: a surname has a different shape to a
// business name.
const LIMITS = {
  firstName: { min: 1, max: 60 },
  lastName: { min: 1, max: 60 },
  phone: { min: 6, max: 20 },
  email: { min: 5, max: 254 },
  businessName: { min: 2, max: 120 },
  state: { min: 2, max: 80 },
};

function lengthError(label, value, { min, max }) {
  const length = String(value || '').trim().length;
  if (length < min) return `${label} must be at least ${min} character${min === 1 ? '' : 's'}`;
  if (length > max) return `${label} must be ${max} characters or fewer`;
  return null;
}

// "mike o'BRIEN" -> "Mike O'Brien". Capital at the start of each word, the
// rest lower case, with the separators people actually have in their names
// left intact.
export function toPersonName(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

// Digits, and the +, spaces and brackets people write around them. Stored as
// typed minus the noise, so an area code stays visible.
function normalisePhone(raw) {
  const cleaned = String(raw || '').trim().replace(/[^\d+\s()-]/g, '');
  return cleaned.replace(/\s+/g, ' ').trim();
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const registrationEnabled = await getSetting('registration_enabled');
    if (registrationEnabled === 'false') {
      return res.status(403).json({ error: 'Registrations are currently closed' });
    }

    const {
      firstName,
      lastName,
      dateOfBirth,
      phone,
      email,
      confirmEmail,
      currency,
      country,
      state,
      planType,
      promoCode,
      businessName,
      referralSource,
      termsAccepted,
      captchaToken,
      captchaAnswer,
    } = req.body || {};

    if (!verifyCaptcha(captchaToken, captchaAnswer)) {
      return res.status(400).json({ error: 'The verification answer was wrong — try the new sum' });
    }

    for (const [field, label] of [
      ['firstName', 'First name'],
      ['lastName', 'Last name'],
    ]) {
      const error = lengthError(label, req.body?.[field], LIMITS[field]);
      if (error) return res.status(400).json({ error });
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    const emailLength = lengthError('Email', normalizedEmail, LIMITS.email);
    if (emailLength) return res.status(400).json({ error: emailLength });
    if (normalizedEmail !== String(confirmEmail || '').trim().toLowerCase()) {
      return res.status(400).json({ error: 'The two email addresses don’t match' });
    }

    // Old enough to be running a business, and not a typo like 1899.
    const dob = String(dateOfBirth || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({ error: 'Enter your date of birth' });
    }
    const dobDate = new Date(`${dob}T00:00:00Z`);
    const years = (Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(dobDate.getTime()) || years < 16) {
      return res.status(400).json({ error: 'You must be at least 16 to open an account' });
    }
    if (years > 120) return res.status(400).json({ error: 'Check the date of birth — that year looks wrong' });

    const matchedCountry = countryByName(country);
    if (!matchedCountry) return res.status(400).json({ error: 'Choose your country' });
    if (!isValidState(matchedCountry.name, state)) {
      return res.status(400).json({ error: 'Choose your state or region' });
    }
    const stateError = lengthError('State', state, LIMITS.state);
    if (stateError) return res.status(400).json({ error: stateError });

    const finalCurrency = String(currency || '').toUpperCase();
    if (!isKnownCurrency(finalCurrency)) return res.status(400).json({ error: 'Choose your preferred currency' });

    const cleanedPhone = normalisePhone(phone);
    if (cleanedPhone) {
      const phoneError = lengthError('Phone number', cleanedPhone, LIMITS.phone);
      if (phoneError) return res.status(400).json({ error: phoneError });
      if ((cleanedPhone.match(/\d/g) || []).length < 6) {
        return res.status(400).json({ error: 'Enter a valid phone number' });
      }
    }

    if (businessName && String(businessName).trim()) {
      const businessError = lengthError('Business name', businessName, LIMITS.businessName);
      if (businessError) return res.status(400).json({ error: businessError });
    }

    if (!referralSource || !REFERRAL_SOURCES.includes(String(referralSource))) {
      return res.status(400).json({ error: 'Let us know how you heard about us' });
    }
    if (termsAccepted !== true) {
      return res.status(400).json({ error: 'You must accept the Terms of Service and Privacy Policy to continue' });
    }

    const finalPlanType = planType === 'family' ? 'family' : 'individual';

    // Checked again here rather than trusted from the form — the price shown
    // during sign-up came from an endpoint anyone can call.
    let finalPromo = null;
    if (promoCode && String(promoCode).trim()) {
      const plans = await getSignupPlans();
      const plan = plans.find((p) => p.planType === finalPlanType);
      const result = await evaluatePromoCode(promoCode, finalPlanType, plan?.amountPerYear);
      if (!result.ok) return res.status(400).json({ error: result.reason });
      finalPromo = result.promo.code;
    }

    const first = toPersonName(firstName);
    const last = toPersonName(lastName);
    const fullName = `${first} ${last}`.trim();

    // No password at sign-up: it's set when the activation link is opened,
    // which proves the address works before an account can be used.
    const placeholderHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const mfaMode = await getMfaMode();
    const otpEnabledAtSignup = mfaMode === 'required' ? 1 : 0;
    const { token, tokenHash, expiresAt } = generateActivationToken();

    let userId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO users
           (email, password_hash, name, first_name, last_name, date_of_birth, phone, otp_enabled, otp_prompted,
            role, plan_type, promo_code, currency, country, state, business_name, referral_source,
            terms_accepted_at, activation_token_hash, activation_token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'owner', ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [
          normalizedEmail,
          placeholderHash,
          fullName,
          first,
          last,
          dob,
          cleanedPhone || null,
          otpEnabledAtSignup,
          finalPlanType,
          finalPromo,
          finalCurrency,
          matchedCountry.name,
          String(state).trim(),
          businessName ? String(businessName).trim().slice(0, 120) : null,
          String(referralSource),
          tokenHash,
          expiresAt,
        ]
      );
      userId = result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      throw err;
    }

    await seedDefaultCategories(pool, userId);
    if (finalPromo) await recordPromoRedemption(finalPromo);

    const activationUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/activate?token=${token}`;
    try {
      await sendActivationEmail(normalizedEmail, first, activationUrl, {
        planType: finalPlanType,
        trialDays: TRIAL_DAYS,
        expiryDays: ACTIVATION_TOKEN_DAYS,
      });
    } catch (err) {
      console.error('Failed to send activation email', err);
    }

    res.status(201).json({ pendingActivation: true, email: normalizedEmail });
  })
);

// Confirms a link is still good before showing the set-password form, so
// somebody doesn't choose a password only to be told the link expired.
router.get(
  '/activate/check',
  asyncHandler(async (req, res) => {
    const user = await findActivationCandidate(req.query?.token);
    if (!user) return res.status(400).json({ error: 'This activation link is invalid or has expired.' });
    res.json({ ok: true, email: user.email, firstName: user.first_name || user.name });
  })
);

async function findActivationCandidate(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE activation_token_hash = ? AND activated_at IS NULL',
    [tokenHash]
  );
  const user = rows[0];
  if (!user || new Date(user.activation_token_expires_at) < new Date()) return null;
  return user;
}

// Activation is where the password is set — the account is created without
// one, so opening this link is what proves the address belongs to whoever
// signed up.
router.post(
  '/activate',
  asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Activation token is required' });
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number',
      });
    }

    const user = await findActivationCandidate(token);
    if (!user) return res.status(400).json({ error: 'This activation link is invalid or has expired.' });

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await pool.execute(
      `UPDATE users SET password_hash = ?, activated_at = NOW(), activation_token_hash = NULL,
       activation_token_expires_at = NULL, trial_ends_at = ?, subscription_status = 'trialing' WHERE id = ?`,
      [hashPassword(password), trialEndsAt, user.id]
    );

    try {
      await sendAccountActivatedEmail(user.email, user.first_name || user.name, {
        planType: user.plan_type,
        trialEndsAt,
      });
    } catch (err) {
      console.error('Failed to send activation confirmation email', err);
    }

    const jwt = signToken(user);
    res.cookie(COOKIE_NAME, jwt, cookieOptions());
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

    // Five minutes between sends. Returned to the caller so the button can
    // show a live countdown rather than silently doing nothing when pressed.
    const issuedAt = new Date(
      new Date(user.activation_token_expires_at).getTime() - ACTIVATION_TOKEN_DAYS * 24 * 60 * 60 * 1000
    );
    const sinceIssued = Date.now() - issuedAt.getTime();
    if (user.activation_token_expires_at && sinceIssued < RESEND_COOLDOWN_MS) {
      return res.json({ ok: true, retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceIssued) / 1000) });
    }

    const { token, tokenHash, expiresAt } = generateActivationToken();
    await pool.execute('UPDATE users SET activation_token_hash = ?, activation_token_expires_at = ? WHERE id = ?', [
      tokenHash,
      expiresAt,
      user.id,
    ]);

    const activationUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/activate?token=${token}`;
    try {
      await sendActivationEmail(user.email, user.first_name || user.name, activationUrl, {
        planType: user.plan_type,
        trialDays: TRIAL_DAYS,
        expiryDays: ACTIVATION_TOKEN_DAYS,
      });
    } catch (err) {
      console.error('Failed to send activation email', err);
    }

    res.json({ ok: true, retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000) });
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

    // Invited sub_user/accountant rows ride on their account holder's
    // subscription (see computeAccessLocked), so they don't need their own
    // trial. A standalone owner row created by an admin does need one,
    // same as a self-registered owner gets on activation.
    const needsOwnTrial = user.role === 'owner';
    const trialEndsAt = needsOwnTrial ? new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000) : null;

    await pool.execute(
      `UPDATE users SET password_hash = ?, activated_at = NOW(), activation_token_hash = NULL, activation_token_expires_at = NULL
       ${needsOwnTrial ? ", trial_ends_at = ?, subscription_status = 'trialing'" : ''}
       WHERE id = ?`,
      needsOwnTrial ? [hashPassword(password), trialEndsAt, user.id] : [hashPassword(password), user.id]
    );

    if (needsOwnTrial) {
      user.trial_ends_at = trialEndsAt;
      user.subscription_status = 'trialing';
    }

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
    // Everything captured at sign-up can be corrected here except how they
    // heard about us — that's a one-time answer about a moment that's passed,
    // and letting it be edited later would only corrupt what it exists for.
    const { firstName, lastName, dateOfBirth, phone, email, currency, country, state, businessName } = req.body || {};

    for (const [value, label, limits] of [
      [firstName, 'First name', LIMITS.firstName],
      [lastName, 'Last name', LIMITS.lastName],
    ]) {
      const error = lengthError(label, value, limits);
      if (error) return res.status(400).json({ error });
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) return res.status(400).json({ error: 'Enter a valid email address' });

    const dob = String(dateOfBirth || '').slice(0, 10);
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: 'Enter a valid date of birth' });

    const matchedCountry = countryByName(country);
    if (!matchedCountry) return res.status(400).json({ error: 'Choose your country' });
    if (!isValidState(matchedCountry.name, state)) return res.status(400).json({ error: 'Choose your state or region' });

    const finalCurrency = String(currency || '').toUpperCase();
    if (!isKnownCurrency(finalCurrency)) return res.status(400).json({ error: 'Choose your preferred currency' });

    const cleanedPhone = normalisePhone(phone);
    if (cleanedPhone && (cleanedPhone.match(/\d/g) || []).length < 6) {
      return res.status(400).json({ error: 'Enter a valid phone number' });
    }

    const first = toPersonName(firstName);
    const last = toPersonName(lastName);
    const fullName = `${first} ${last}`.trim();
    const trimmedBusinessName = businessName ? String(businessName).trim().slice(0, 120) : null;

    try {
      await pool.execute(
        `UPDATE users SET name = ?, first_name = ?, last_name = ?, date_of_birth = ?, phone = ?, email = ?,
         currency = ?, country = ?, state = ?, business_name = ? WHERE id = ?`,
        [
          fullName,
          first,
          last,
          dob || null,
          cleanedPhone || null,
          normalizedEmail,
          finalCurrency,
          matchedCountry.name,
          String(state).trim(),
          trimmedBusinessName,
          req.user.id,
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      throw err;
    }

    res.json({
      user: {
        ...req.user,
        name: fullName,
        firstName: first,
        lastName: last,
        dateOfBirth: dob || null,
        phone: cleanedPhone || null,
        email: normalizedEmail,
        currency: finalCurrency,
        country: matchedCountry.name,
        state: String(state).trim(),
        businessName: trimmedBusinessName,
      },
    });
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
      fs.unlink(path.join(avatarsDir, previousPath), () => {});
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
    res.sendFile(path.join(avatarsDir, row.avatar_path));
  })
);

router.delete(
  '/avatar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT avatar_path FROM users WHERE id = ?', [req.user.id]);
    const previousPath = rows[0]?.avatar_path;
    if (!previousPath) return res.status(404).json({ error: 'No avatar to remove' });

    await pool.execute('UPDATE users SET avatar_path = NULL WHERE id = ?', [req.user.id]);
    fs.unlink(path.join(avatarsDir, previousPath), () => {});

    res.json({ ok: true });
  })
);

export default router;
