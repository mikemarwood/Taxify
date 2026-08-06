import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool, { getSetting, getMfaMode } from '../db.js';
import { hashPassword, verifyPassword, isStrongPassword } from '../auth/password.js';
import { signToken, signAccountantToken, cookieOptions, COOKIE_NAME } from '../auth/jwt.js';
import { requireAuth, requireAccountOwner } from '../auth/middleware.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';
import { ensureDefaultEntity } from '../lib/entities.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { generateOtp, hashOtp, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS, OTP_LOCKOUT_MINUTES } from '../auth/otp.js';
import { toPublicUser } from '../auth/publicUser.js';
import { recordLogin } from '../lib/deviceInfo.js';
import { computeAccessLocked } from '../auth/access.js';
import {
  listAssignments,
  openAssignment,
  hasAssignments,
  parseYearGrant,
  normaliseWindowHours,
  describeWindow,
  ACCOUNTANT_WINDOW_HOURS,
  ACCOUNTANT_WINDOW_CHOICES,
} from '../auth/accountants.js';
import {
  sendOtpEmail,
  sendActivationEmail,
  sendInviteEmail,
  sendAccountActivatedEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendEmailChangeEmail,
  sendEmailChangedNoticeEmail,
  sendAccountantAccessGrantedEmail,
  sendAccountantInviteEmail,
  sendAccountantAccessUpdatedEmail,
  sendAccountantAccessEndedEmail,
} from '../lib/mailer.js';
import { ACTIVATION_TOKEN_DAYS, generateActivationToken } from '../auth/activationToken.js';
import {
  generateInviteToken,
  findInviteByToken,
  inviteAcceptOutcome,
  pendingInvites,
  INVITE_LIFETIME_HOURS,
} from '../auth/accountantInvites.js';
import { COUNTRIES, STATES, CURRENCIES, countryByName, countryByCode, isKnownCurrency, isValidState } from '../lib/geoData.js';
import { financialYearForCountry, normaliseRule, COUNTRY_FINANCIAL_YEARS } from '../lib/financialYear.js';
import { createCaptcha, verifyCaptcha } from '../lib/captcha.js';
import { assignAccountNumber } from '../lib/accountNumber.js';
import { getSignupPlans } from '../lib/stripe.js';
import { evaluatePromoCode, recordPromoRedemption } from '../lib/promoCodes.js';

const TRIAL_DAYS = 14;

// Seconds from now until a stored timestamp, worked out entirely server-side.
// The pool returns DATETIMEs as strings with no timezone on them, so a browser
// parses one as its own local time — which is wrong by however far the two are
// apart. Sending a duration instead sidesteps the whole problem.
function secondsUntil(value) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
}

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
      // So the form can say "your tax year runs 6 April to 5 April" for a
      // country we know, and ask when we don't.
      financialYears: COUNTRY_FINANCIAL_YEARS,
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
      // Named so the form can show this under the sum rather than as a toast
      // in the opposite corner from the box it is about.
      return res.status(400).json({ error: 'That answer was not right — here is a new sum', field: 'captcha' });
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

    const finalPlanType = planType === 'business' ? 'business' : 'individual';

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

    // Which twelve months count as a year for this person. Known countries get
    // it automatically; anywhere we don't know, they must say — guessing would
    // file their whole history into the wrong years, which is also why country
    // is not editable afterwards.
    const knownRule = financialYearForCountry(matchedCountry.name);
    let fyRule = knownRule;
    if (!fyRule) {
      const asked = req.body?.financialYearStart;
      const month = Number(asked?.month);
      const day = Number(asked?.day);
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 28) {
        return res.status(400).json({ error: 'financial_year_required', country: matchedCountry.name });
      }
      fyRule = normaliseRule({ startMonth: month, startDay: day });
    }

    let userId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO users
           (email, password_hash, name, first_name, last_name, date_of_birth, phone, otp_enabled, otp_prompted,
            role, plan_type, promo_code, currency, country, state, referral_source,
            fy_start_month, fy_start_day,
            terms_accepted_at, activation_token_hash, activation_token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'owner', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
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
          String(referralSource),
          fyRule.startMonth,
          fyRule.startDay,
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

    // Their books, then the categories inside them. Seeding without an entity
    // is what left the earliest accounts with an empty, unrepairable Categories
    // page — see migrations/categoryEntities.js.
    const books = await ensureDefaultEntity(userId);
    await seedDefaultCategories(pool, userId, books?.id ?? null);

    // The number they will be shown. Assigned here rather than left to the
    // boot migration, so somebody who signs up between restarts still has one.
    try {
      await assignAccountNumber(pool, userId);
    } catch (err) {
      console.error('Could not assign an account number at signup', err);
    }

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
    const { name, email, role, financialYears } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email is required' });
    // The only kind of invitation there is. A second login on one account was
    // removed with the Family plan — two people means two accounts.
    if (role !== 'accountant') {
      return res.status(400).json({ error: 'Only an accountant can be invited' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const displayName = String(name).trim();

    // A family member is a second person on this account, so there is only ever
    // room for one and only on the plan that includes them.
    if (role === 'sub_user') {
      if (req.user.planType !== 'family') {
        return res.status(400).json({ error: 'Only an accountant can be invited' });
      }
      const [existingRows] = await pool.execute(
        "SELECT id FROM users WHERE account_holder_id = ? AND role = 'sub_user'",
        [req.user.id]
      );
      if (existingRows.length > 0) {
        return res.status(400).json({ error: 'Only an accountant can be invited' });
      }
    }

    // Only accountants can be scoped to particular years. A family member is a
    // co-owner of the same books, not a visitor with a reading window.
    //
    // The caller has to say which it means. "Every year" is { allYears: true };
    // a list is a list. Left to infer, an omitted field and a list where every
    // entry was rejected look identical — and both used to mean the whole
    // history, so a client who mistyped their years handed over everything.
    let yearScope = null;
    let rejectedYears = [];
    if (role === 'accountant' && req.body?.allYears !== true) {
      const grant = parseYearGrant(financialYears);
      if (!grant.ok) {
        return res.status(400).json({
          error: grant.tooMany
            ? 'That is more financial years than an account can have — pick the ones they need.'
            : "None of those look like financial years. Pick them from the list, or choose every year.",
          rejectedYears: grant.rejected,
        });
      }
      yearScope = grant.value;
      rejectedYears = grant.rejected;
    }

    // How long their window lasts once opened. The client's choice, defaulting
    // to a day when they express no view.
    const windowHours =
      role === 'accountant'
        ? normaliseWindowHours(req.body?.windowHours) ?? ACCOUNTANT_WINDOW_HOURS
        : ACCOUNTANT_WINDOW_HOURS;

    if (role === 'accountant') {
      // An accountant works for several people, so the same address turning up
      // again is the normal case, not a collision — it gets another assignment
      // rather than another login.
      //
      // activated_at matters here. A row that was invited and never accepted is
      // not a login: its password is a random string nobody has ever seen. It
      // used to match this branch anyway, and the person was told to sign in
      // with credentials that had never existed.
      const [existing] = await pool.execute(
        'SELECT id, role, name, activated_at FROM users WHERE email = ?',
        [normalizedEmail]
      );
      const found = existing[0]?.activated_at ? existing[0] : null;

      if (found) {
        // An account holder who also does other people's books is one login
        // with both hats, so an existing Taxify user is a perfectly good
        // accountant — they simply gain a client. The one thing that would be
        // absurd is giving someone access to their own account.
        if (found.id === req.user.id) {
          return res.status(400).json({ error: 'You already have access to your own account' });
        }
        const [already] = await pool.execute(
          'SELECT id FROM accountant_assignments WHERE accountant_user_id = ? AND owner_user_id = ?',
          [found.id, req.user.id]
        );
        if (already.length > 0) {
          return res.status(400).json({ error: 'That accountant already has access to your account' });
        }
        await pool.execute(
          'INSERT INTO accountant_assignments (accountant_user_id, owner_user_id, financial_years, window_hours) VALUES (?, ?, ?, ?)',
          [found.id, req.user.id, yearScope, windowHours]
        );

        const loginUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/login`;
        let emailed = true;
        try {
          await sendAccountantAccessGrantedEmail(
            normalizedEmail,
            found.name,
            req.user.name,
            loginUrl,
            yearScope,
            describeWindow(windowHours)
          );
        } catch (err) {
          console.error('Failed to send accountant access email', err);
          emailed = false;
        }
        // They may be signed in right now, in which case a client appearing on
        // their list with no explanation is the worse outcome.
        await notify(found.id, {
          title: `${req.user.name || req.user.email} has shared their books with you`,
          body: `Read-only, for ${describeWindow(windowHours)} from the first time you open them.`,
          url: '/clients',
          kind: 'accountant',
        });
        return res.status(201).json({ ok: true, existingAccountant: true, emailed, rejectedYears });
      }

      // Nobody by that address, so there is nothing to grant yet — only an
      // offer. No users row is created here on purpose: see accountant_invites
      // in db.js for the three things that went wrong when one was.
      const { token, tokenHash, expiresAt } = generateInviteToken();
      await pool.execute(
        `INSERT INTO accountant_invites (owner_user_id, email, name, financial_years, window_hours, token_hash, expires_at, last_sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), financial_years = VALUES(financial_years), window_hours = VALUES(window_hours),
           token_hash = VALUES(token_hash), expires_at = VALUES(expires_at), last_sent_at = NOW(),
           accepted_at = NULL, accepted_user_id = NULL`,
        [req.user.id, normalizedEmail, displayName, yearScope, windowHours, tokenHash, expiresAt]
      );

      const acceptUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${token}`;
      let emailed = true;
      try {
        await sendAccountantInviteEmail(
          normalizedEmail,
          displayName,
          req.user.name,
          acceptUrl,
          yearScope,
          describeWindow(windowHours),
          `in ${INVITE_LIFETIME_HOURS} hours`
        );
      } catch (err) {
        console.error('Failed to send accountant invitation', err);
        emailed = false;
      }

      // A failed send must not roll back the invitation — but the owner has to
      // be told, or they will assume it arrived and wonder why nothing happens.
      return res.status(201).json({ ok: true, invited: true, emailed, rejectedYears });
    }
    // Only an accountant reaches this route now. The branch above always
    // returns, whether it granted access to somebody who already has an
    // account or sent an invitation to somebody who does not.
    //
    // What used to follow was the second login: it created a user row for a
    // family member. That is gone deliberately — an account belongs to one
    // person. See migrations/removeSecondLogins.js.
    return res.status(500).json({ error: 'Unsupported invitation' });
  })
);

// --- Accountant client picker --------------------------------------------

// Deliberately outside requireActiveAccess: an accountant reaches this before
// they have a client, which is exactly the state that middleware rejects.
router.get(
  '/clients',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await hasAssignments(req.user.id))) return res.status(403).json({ error: 'You do not act for any clients' });

    const clients = await listAssignments(req.user.id);

    // Enough about each client to tell them apart when several are listed —
    // whose books, how big, and how much of the history was shared.
    const enriched = await Promise.all(
      clients.map(async (c) => {
        const [rows] = await pool.execute(
          `SELECT COUNT(*) AS n, COALESCE(SUM(e.amount), 0) AS total, MAX(e.purchase_date) AS latest
           FROM expenses e
           JOIN users u ON u.id = e.user_id
           WHERE (u.id = ? OR u.account_holder_id = ?) AND u.role <> 'accountant' AND e.deleted_at IS NULL`,
          [c.ownerId, c.ownerId]
        );
        return {
          ...c,
          expenseCount: Number(rows[0]?.n) || 0,
          totalAmount: Number(rows[0]?.total) || 0,
          latestExpense: rows[0]?.latest || null,
        };
      })
    );

    // accountHolderId means "the account this login belongs to" again, so the
    // open client has to come from the session rather than from the user row.
    res.json({
      clients: enriched,
      activeClientId: req.user.actingAsClient?.id || null,
      windowHours: ACCOUNTANT_WINDOW_HOURS,
    });
  })
);

// Back to the picker without logging out. Must be registered BEFORE
// /clients/:ownerId — Express matches in order, so with these the other way
// round "exit" was read as an owner id, became NaN, and Switch client failed.
router.post(
  '/clients/exit',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await hasAssignments(req.user.id))) return res.status(403).json({ error: 'You do not act for any clients' });
    res.cookie(COOKIE_NAME, signToken(req.user), cookieOptions(false));
    res.json({ ok: true });
  })
);

// Opening a client starts their 24-hour window if this is the first look, and
// re-issues the session cookie naming that client.
router.post(
  '/clients/:ownerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!(await hasAssignments(req.user.id))) return res.status(403).json({ error: 'You do not act for any clients' });

    // The door. This is the only route that issues a client-scoped token, and
    // the moment a window would start — so the check belongs here rather than
    // anywhere that merely reads. Refused before openAssignment, so a blocked
    // attempt cannot start somebody's clock.
    if (!req.user.accountantSetup?.ready) {
      return res.status(403).json({
        error: 'accountant_setup_required',
        missing: req.user.accountantSetup?.missing || [],
      });
    }

    const ownerId = Number(req.params.ownerId);
    if (!Number.isInteger(ownerId)) return res.status(400).json({ error: 'Unknown client' });

    const assignment = await openAssignment(req.user.id, ownerId);
    if (!assignment) return res.status(404).json({ error: 'That access has been removed or has expired.' });

    // Somebody opening your books is worth knowing about at the time, not when
    // you next happen to look. The 24-hour window starts now, which makes this
    // also the moment a client could still cut it short if it wasn't expected.
    if (assignment.firstOpen) {
      await notify(ownerId, {
        title: 'Your accountant opened your books',
        body: `${req.user.name || req.user.email} has access for the next ${describeWindow(assignment.windowHours ?? assignment.window_hours)}. You can remove it at any time.`,
        url: '/account',
        kind: 'accountant',
      });
    }

    // The token cannot outlive the window it was issued for, so it takes its
    // length from the same row rather than from a constant that no longer
    // decides anything.
    res.cookie(
      COOKIE_NAME,
      signAccountantToken(
        req.user,
        ownerId,
        normaliseWindowHours(assignment.windowHours ?? assignment.window_hours) ?? ACCOUNTANT_WINDOW_HOURS
      ),
      cookieOptions(false)
    );
    res.json({ ok: true, expiresAt: assignment.expires_at || assignment.expiresAt || null });
  })
);

// An accountant who was only ever invited to look at other people's books
// deciding to keep their own. They become an ordinary account holder — same
// trial, same plans, same everything — while keeping every client they had.
router.post(
  '/start-own-account',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'accountant') {
      return res.status(400).json({ error: 'You already have your own Taxify account' });
    }

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await pool.execute(
      // account_holder_id is cleared, not just left behind. It pointed at the
      // client who first invited them, and an account holder who "belongs to"
      // somebody else is a contradiction — one that would put their private
      // expenses inside that client's books.
      `UPDATE users SET role = 'owner', account_holder_id = NULL,
       plan_type = COALESCE(plan_type, 'individual'),
       subscription_status = 'trialing', trial_ends_at = ? WHERE id = ?`,
      [trialEndsAt, req.user.id]
    );

    // Their own books start with the same defaults as anybody else's.
    const ownBooks = await ensureDefaultEntity(req.user.id);
    await seedDefaultCategories(pool, req.user.id, ownBooks?.id ?? null);

    // The session is re-signed without a client, so they land in their own
    // account rather than in whoever they were last looking at.
    res.cookie(COOKIE_NAME, signToken(req.user), cookieOptions(false));
    res.json({ ok: true, trialEndsAt });
  })
);

// What is behind an invitation link, before anything is submitted, so the page
// can render the right thing rather than a password box for somebody who
// already has an account.
router.get(
  '/accountant-invite/check',
  asyncHandler(async (req, res) => {
    const invite = await findInviteByToken(req.query?.token);
    if (!invite) return res.status(404).json({ error: 'invalid' });

    const [existing] = await pool.execute('SELECT id, name, activated_at FROM users WHERE email = ?', [invite.email]);
    const outcome = inviteAcceptOutcome({ invite, existingUser: existing[0] || null });

    if (outcome === 'expired') return res.status(410).json({ error: 'expired' });
    if (outcome === 'already_accepted') return res.status(409).json({ error: 'already_accepted' });

    res.json({
      email: invite.email,
      name: invite.name || existing[0]?.name || null,
      inviterName: invite.owner_name,
      financialYears: invite.financial_years ? invite.financial_years.split(',') : null,
      windowHours: invite.window_hours,
      expiresAt: invite.expires_at,
      // The page shows "sign in" rather than a set-up form for these.
      hasAccount: outcome === 'link_existing',
    });
  })
);

// Accepting. Deliberately a separate route from /accept-invite, which still
// serves family members and admin-created accounts — those genuinely do
// pre-create a users row, and leaving that path untouched keeps it at zero risk.
router.post(
  '/accountant-invite/accept',
  asyncHandler(async (req, res) => {
    const invite = await findInviteByToken(req.body?.token);
    const [existing] = await pool.execute(
      'SELECT id, name, activated_at FROM users WHERE email = ?',
      [invite?.email || '']
    );
    const existingUser = existing[0] || null;
    const outcome = inviteAcceptOutcome({ invite, existingUser });

    if (outcome === 'not_found') return res.status(404).json({ error: 'That invitation link is not valid.' });
    if (outcome === 'expired') {
      return res.status(410).json({ error: 'That invitation has expired. Ask them to send you another.' });
    }
    if (outcome === 'already_accepted') {
      return res.status(409).json({ error: 'That invitation has already been used. Sign in instead.' });
    }
    if (outcome === 'self_invite') {
      return res.status(400).json({ error: 'That invitation is for your own account.' });
    }

    async function grantAccess(accountantUserId) {
      await pool.execute(
        `INSERT INTO accountant_assignments (accountant_user_id, owner_user_id, financial_years, window_hours)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE financial_years = VALUES(financial_years), window_hours = VALUES(window_hours)`,
        [accountantUserId, invite.owner_user_id, invite.financial_years, invite.window_hours]
      );
      await pool.execute(
        'UPDATE accountant_invites SET accepted_at = NOW(), accepted_user_id = ?, token_hash = NULL WHERE id = ?',
        [accountantUserId, invite.id]
      );
      // The owner asked for this and has heard nothing since. This is the
      // notification they most obviously lacked.
      await notify(invite.owner_user_id, {
        title: 'Your accountant accepted',
        body: `They can now open your books. You will be told the first time they do.`,
        url: '/account',
        kind: 'accountant',
      });
    }

    // An invitation token proves control of a mailbox and nothing more. It may
    // create a login; it may never write to one. Letting mailbox-proof set a
    // password on an account that already exists would make a forwarded
    // invitation email into account takeover.
    if (outcome === 'link_existing') {
      await grantAccess(existingUser.id);
      return res.json({ existingAccount: true });
    }

    const { firstName, lastName, practiceName, phone, password } = req.body || {};
    const first = toPersonName(firstName);
    const last = toPersonName(lastName);
    if (!first || !last) return res.status(400).json({ error: 'Enter your first and last name' });

    const firm = String(practiceName || '').trim();
    if (firm.length < 2) return res.status(400).json({ error: 'Enter your practice or firm name' });

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number',
      });
    }

    const cleanedPhone = phone ? normalisePhone(phone) : null;
    if (phone && !cleanedPhone) return res.status(400).json({ error: 'Enter a valid phone number' });

    let userId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO users (email, password_hash, name, first_name, last_name, phone, practice_name,
           role, account_holder_id, activated_at, subscription_status, terms_accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'accountant', NULL, NOW(), 'none', NOW())`,
        [
          invite.email,
          hashPassword(password),
          `${first} ${last}`.trim(),
          first,
          last,
          cleanedPhone,
          firm.slice(0, 160),
        ]
      );
      userId = result.insertId;
    } catch (err) {
      // Two people accepting at once, or an account created in between. The
      // loser links rather than failing.
      if (err.code === 'ER_DUP_ENTRY') {
        const [again] = await pool.execute('SELECT id FROM users WHERE email = ?', [invite.email]);
        if (again[0]) {
          await grantAccess(again[0].id);
          return res.json({ existingAccount: true });
        }
      }
      throw err;
    }

    await grantAccess(userId);

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const publicUser = toPublicUser(rows[0], await getMfaMode());
    publicUser.isAccountant = true;
    publicUser.accessLocked = await computeAccessLocked(publicUser);

    res.cookie(COOKIE_NAME, signToken(rows[0]), cookieOptions(true));
    res.status(201).json({ user: publicUser });
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
    publicUser.isAccountant = await hasAssignments(user.id);
    publicUser.accessLocked = await computeAccessLocked(publicUser);
    res.json({ user: publicUser });
  })
);

router.patch(
  '/accountant-access/:ownerAssignmentId',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT id, accountant_user_id, financial_years, window_hours FROM accountant_assignments WHERE id = ? AND owner_user_id = ?',
      [req.params.ownerAssignmentId, req.user.id]
    );
    const assignment = rows[0];
    if (!assignment) return res.status(404).json({ error: 'Not found' });

    const updates = [];
    const params = [];
    const changes = [];

    // Only touched when the request actually carries a scope decision. A body
    // of { reopen: true } must leave the years exactly as they were — clearing
    // them would mean "the whole history", so an extension of time would
    // quietly become an extension of scope.
    const saysAllYears = req.body?.allYears === true;
    const saysYears = Object.prototype.hasOwnProperty.call(req.body || {}, 'financialYears');

    if (saysAllYears || saysYears) {
      let value = null;
      if (!saysAllYears) {
        const grant = parseYearGrant(req.body.financialYears);
        if (!grant.ok) {
          return res.status(400).json({
            error: grant.tooMany
              ? 'That is more financial years than an account can have — pick the ones they need.'
              : 'None of those look like financial years. Pick them from the list, or choose every year.',
            rejectedYears: grant.rejected,
          });
        }
        value = grant.value;
      }
      const after = value ? value.split(',') : null;
      updates.push('financial_years = ?');
      params.push(value);
      changes.push(
        after ? `financial ${after.length === 1 ? 'year' : 'years'} ${after.join(', ')}` : 'every financial year'
      );
    }

    if (req.body?.windowHours !== undefined) {
      const hours = normaliseWindowHours(req.body.windowHours);
      if (!hours) return res.status(400).json({ error: 'Choose 24, 48, 72 or 96 hours' });
      updates.push('window_hours = ?');
      params.push(hours);
      changes.push(`a ${describeWindow(hours)} window`);
    }

    if (req.body?.reopen === true) {
      // Back to "granted, not opened yet", so the clock restarts when they next
      // look rather than from now. Setting a new expiry instead would burn the
      // window whether or not they came back — which is the whole reason the
      // clock starts on first open in the first place.
      updates.push('first_login_at = NULL', 'expires_at = NULL');
      changes.push('a fresh window, starting when they next open your books');
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to change' });

    await pool.execute(`UPDATE accountant_assignments SET ${updates.join(', ')} WHERE id = ? AND owner_user_id = ?`, [
      ...params,
      assignment.id,
      req.user.id,
    ]);

    // Narrowing takes effect on their very next request, because requireAuth
    // re-reads the assignment on every one. Either way they are told, rather
    // than discovering it when something they could see yesterday is gone.
    await notify(assignment.accountant_user_id, {
      title: `${req.user.name || req.user.email} updated your access`,
      body: `You now have ${changes.join(', and ')}.`,
      url: '/clients',
      kind: 'accountant',
    });

    res.json({ ok: true });
  })
);

// Sending the invitation again, with a fresh link. The old one stops working
// the moment this runs, so a forwarded copy of the previous email is dead.
router.post(
  '/accountant-invites/:id/resend',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT * FROM accountant_invites WHERE id = ? AND owner_user_id = ? AND accepted_at IS NULL',
      [req.params.id, req.user.id]
    );
    const invite = rows[0];
    if (!invite) return res.status(404).json({ error: 'Not found' });

    const sinceLast = invite.last_sent_at ? Date.now() - new Date(invite.last_sent_at).getTime() : Infinity;
    if (sinceLast < RESEND_COOLDOWN_MS) {
      return res.status(429).json({
        error: 'That was just sent — give it a minute before trying again.',
        retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000),
      });
    }

    const { token, tokenHash, expiresAt } = generateInviteToken();
    await pool.execute(
      'UPDATE accountant_invites SET token_hash = ?, expires_at = ?, last_sent_at = NOW() WHERE id = ?',
      [tokenHash, expiresAt, invite.id]
    );

    const acceptUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${token}`;
    let emailed = true;
    try {
      await sendAccountantInviteEmail(
        invite.email,
        invite.name,
        req.user.name,
        acceptUrl,
        invite.financial_years,
        describeWindow(invite.window_hours),
        `in ${INVITE_LIFETIME_HOURS} hours`
      );
    } catch (err) {
      console.error('Failed to resend accountant invitation', err);
      emailed = false;
    }
    res.json({ ok: true, emailed });
  })
);

// Taking it back. Mistyping an address had no undo at all before — the
// invitation simply sat there until it lapsed.
router.delete(
  '/accountant-invites/:id',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM accountant_invites WHERE id = ? AND owner_user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    // No email. There is no account to notify, and "never mind" to somebody who
    // may not have read the first one is noise — the dead link explains itself.
    res.json({ ok: true });
  })
);

// Revoking an accountant is the owner's to do — unlike a family member, an
// accountant is a visitor, and their access was always meant to end.
router.delete(
  '/accountant-access/:ownerAssignmentId',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT accountant_user_id FROM accountant_assignments WHERE id = ? AND owner_user_id = ?',
      [req.params.ownerAssignmentId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    const [result] = await pool.execute('DELETE FROM accountant_assignments WHERE id = ? AND owner_user_id = ?', [
      req.params.ownerAssignmentId,
      req.user.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });

    // Told, rather than left to notice. The way in was always announced; the
    // way out was silent, so a client simply vanished from their list.
    await notify(rows[0].accountant_user_id, {
      title: `${req.user.name || req.user.email} has removed your access`,
      body: 'Their books are no longer on your client list. Nothing of yours was affected.',
      url: '/clients',
      kind: 'accountant',
    });
    try {
      const [who] = await pool.execute('SELECT email, name FROM users WHERE id = ?', [rows[0].accountant_user_id]);
      if (who[0]) {
        await sendAccountantAccessEndedEmail(who[0].email, who[0].name, req.user.name, 'revoked');
      }
    } catch (err) {
      console.error('Failed to tell the accountant their access ended', err);
    }

    res.json({ ok: true });
  })
);

// Who currently has accountant access to this account, and until when.
router.get(
  '/accountant-access',
  requireAuth,
  requireAccountOwner,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT a.id, a.financial_years, a.window_hours, a.first_login_at, a.expires_at, a.created_at,
              u.name, u.email, u.activated_at, u.practice_name, u.phone
       FROM accountant_assignments a
       JOIN users u ON u.id = a.accountant_user_id
       WHERE a.owner_user_id = ? AND (a.expires_at IS NULL OR a.expires_at > NOW())
       ORDER BY u.name`,
      [req.user.id]
    );
    res.json({
      accountants: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        practiceName: r.practice_name || null,
        phone: r.phone || null,
        active: !!r.activated_at,
        financialYears: r.financial_years ? r.financial_years.split(',') : null,
        windowHours: normaliseWindowHours(r.window_hours) ?? ACCOUNTANT_WINDOW_HOURS,
        firstLoginAt: r.first_login_at,
        expiresAt: r.expires_at,
        grantedAt: r.created_at,
      })),
      // Invitations nobody has accepted yet, so the list can tell "invited"
      // apart from "accepted but hasn't looked" — which read identically before.
      invites: await pendingInvites(req.user.id),
      windowHours: ACCOUNTANT_WINDOW_HOURS,
      windowChoices: ACCOUNTANT_WINDOW_CHOICES,
    });
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
        lockedForSeconds: secondsUntil(user.otp_locked_until),
      });
    }

    const mfaMode = await getMfaMode();
    const mfaRequiredForUser = mfaMode === 'required' || !!user.otp_enabled;

    if (!mfaRequiredForUser) {
      const token = signToken(user);
      res.cookie(COOKIE_NAME, token, cookieOptions(!publicDevice));
      const publicUser = toPublicUser(user, mfaMode);
      // The client decides where to land from this, so it has to know whether
      // they act for anyone as well as whether their own side is active.
      publicUser.isAccountant = await hasAssignments(user.id);
      publicUser.accessLocked = await computeAccessLocked(publicUser);
      await recordLogin(req, user.id, 'password');
      return res.json({ otpRequired: false, user: publicUser });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await pool.execute(
      'UPDATE users SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0, otp_last_sent_at = NOW() WHERE id = ?',
      [hashOtp(code), expiresAt, user.id]
    );

    try {
      await sendOtpEmail(user.email, user.name, code, OTP_TTL_MINUTES);
    } catch (err) {
      console.error('Failed to send OTP email', err);
      await pool.execute('UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?', [user.id]);
      return res.status(500).json({ error: 'Could not send your login code. Please try again shortly.' });
    }

    // Both are sent, but the client counts down from expiresInSeconds. An
    // absolute timestamp is only as good as the agreement between the two
    // clocks, and a server running a few minutes behind makes a code that was
    // just issued read as already expired.
    res.json({
      otpRequired: true,
      userId: user.id,
      expiresAt,
      expiresInSeconds: OTP_TTL_MINUTES * 60,
      publicDevice: !!publicDevice,
    });
  })
);

const OTP_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

// A fresh login code for someone whose first one never arrived. Deliberately
// does not reset otp_attempts: resetting it would turn "resend" into a way
// around the three-strikes lockout.
router.post(
  '/otp/resend',
  asyncHandler(async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Invalid request' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid request' });

    if (user.otp_locked_until && new Date(user.otp_locked_until) > new Date()) {
      return res.status(423).json({
        error: 'Too many incorrect codes. Login is temporarily locked.',
        lockedUntil: user.otp_locked_until,
        lockedForSeconds: secondsUntil(user.otp_locked_until),
      });
    }

    const sinceLast = user.otp_last_sent_at ? Date.now() - new Date(user.otp_last_sent_at).getTime() : Infinity;
    if (sinceLast < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({
        error: 'A code was sent recently — wait before asking for another.',
        retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - sinceLast) / 1000),
      });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await pool.execute('UPDATE users SET otp_code = ?, otp_expires_at = ?, otp_last_sent_at = NOW() WHERE id = ?', [
      hashOtp(code),
      expiresAt,
      user.id,
    ]);

    try {
      await sendOtpEmail(user.email, user.name, code, OTP_TTL_MINUTES);
    } catch (err) {
      console.error('Failed to resend OTP email', err);
      return res.status(500).json({ error: 'Could not send your login code. Please try again shortly.' });
    }

    res.json({
      ok: true,
      expiresInSeconds: OTP_TTL_MINUTES * 60,
      retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
    });
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
        lockedForSeconds: secondsUntil(user.otp_locked_until),
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
          lockedForSeconds: OTP_LOCKOUT_MINUTES * 60,
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
    // MFA is mandatory, so this — not /login — is where most people actually
    // arrive. The client decides where to land from this payload.
    publicUser.isAccountant = await hasAssignments(user.id);
    publicUser.accessLocked = await computeAccessLocked(publicUser);
    await recordLogin(req, user.id, 'otp');
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

    // Holding someone else's books is a higher bar than an ordinary login, so
    // two-factor cannot be switched off while any client is assigned. Turning
    // it on to get through the door and straight back off again would leave
    // nothing standing.
    if (!enabled && (await hasAssignments(req.user.id))) {
      return res.status(400).json({
        error: 'Two-factor login is required while you act for clients. Ask them to remove your access first.',
      });
    }

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
    const { firstName, lastName, dateOfBirth, phone, email, currency, country, state, businessName, practiceName } =
      req.body || {};

    for (const [value, label, limits] of [
      [firstName, 'First name', LIMITS.firstName],
      [lastName, 'Last name', LIMITS.lastName],
    ]) {
      const error = lengthError(label, value, limits);
      if (error) return res.status(400).json({ error });
    }

    // The address is deliberately not editable here. Changing what you sign in
    // with has to be proved at the new address first — see the email-change
    // routes below — so this leaves it alone even if a client sends one.
    const normalizedEmail = req.user.email;

    const dob = String(dateOfBirth || '').slice(0, 10);
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: 'Enter a valid date of birth' });

    // Country and state are fixed after sign-up. The country decides which
    // twelve months count as a financial year, and every expense, receipt
    // folder, category and closed year has already been filed under that
    // answer — changing it here would silently refile someone's whole history
    // into years it was never claimed in.
    const matchedCountry = countryByName(req.user.country);
    const fixedState = req.user.state;

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
    // Only meaningful for someone who acts for clients, but stored for anyone
    // who fills it in — an accountant who later starts their own account keeps
    // both, and losing the firm name at that moment would be the wrong answer.
    const trimmedPracticeName =
      practiceName === undefined ? undefined : practiceName ? String(practiceName).trim().slice(0, 160) : null;

    try {
      await pool.execute(
        `UPDATE users SET name = ?, first_name = ?, last_name = ?, date_of_birth = ?, phone = ?, email = ?,
         currency = ?, business_name = ?${trimmedPracticeName === undefined ? '' : ', practice_name = ?'}
         WHERE id = ?`,
        [
          fullName,
          first,
          last,
          dob || null,
          cleanedPhone || null,
          normalizedEmail,
          finalCurrency,
          trimmedBusinessName,
          ...(trimmedPracticeName === undefined ? [] : [trimmedPracticeName]),
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
        country: matchedCountry?.name || req.user.country,
        state: fixedState,
        businessName: trimmedBusinessName,
        ...(trimmedPracticeName === undefined ? {} : { practiceName: trimmedPracticeName }),
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

// --- Changing the sign-in email ------------------------------------------

const EMAIL_CHANGE_HOURS = 24;
const EMAIL_CHANGE_COOLDOWN_MS = 2 * 60 * 1000;

function pendingEmailState(row) {
  if (!row?.pending_email || !row.pending_email_expires_at) return null;
  const expiresAt = new Date(row.pending_email_expires_at);
  if (expiresAt < new Date()) return null;
  return { pendingEmail: row.pending_email, expiresAt };
}

// Whether a confirmation is currently outstanding, so the page can say so
// rather than looking as though the request went nowhere.
router.get(
  '/email-change',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT pending_email, pending_email_expires_at FROM users WHERE id = ?',
      [req.user.id]
    );
    const pending = pendingEmailState(rows[0]);
    res.json({ pending: pending ? { email: pending.pendingEmail, expiresAt: pending.expiresAt } : null });
  })
);

// The change is only ever requested here — nothing is written to `email`. The
// account carries on signing in with the address it has until the link sent to
// the new one is opened, so a typo or an abandoned request costs nothing.
//
// The current password is required: a session left open on an unlocked machine
// would otherwise be enough to move the account to someone else's address, and
// that is not recoverable by the person who owns it.
router.post(
  '/email-change',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role === 'sub_user') {
      // A family member's address is the invitation the account holder sent —
      // changing it is a matter for that invitation, not for this form.
      //
      // Accountants used to be refused here too and told to ask for a
      // re-invitation, which the invite route could not do for an address that
      // already had a login. Their account is their own — their address, their
      // password, belonging to no account holder — so this was never a rule,
      // only a dead end.
      return res.status(403).json({ error: 'Ask the account holder to re-invite you at a different address.' });
    }

    const { newEmail, currentPassword } = req.body || {};
    const normalized = String(newEmail || '').trim().toLowerCase();

    if (!EMAIL_PATTERN.test(normalized)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (normalized === req.user.email) {
      return res.status(400).json({ error: 'That is already the address on this account' });
    }
    if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to confirm' });

    const [rows] = await pool.execute(
      'SELECT password_hash, first_name, name, pending_email, pending_email_requested_at FROM users WHERE id = ?',
      [req.user.id]
    );
    const row = rows[0];
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      return res.status(401).json({ error: 'That password is not correct' });
    }

    const [taken] = await pool.execute('SELECT id FROM users WHERE email = ?', [normalized]);
    if (taken.length > 0) return res.status(409).json({ error: 'An account with that email already exists' });

    // Re-asking for the same address resends; asking for a different one
    // starts over. Either way it is throttled, so this can't be turned into a
    // way to post mail to a stranger repeatedly.
    if (
      row.pending_email === normalized &&
      row.pending_email_requested_at &&
      Date.now() - new Date(row.pending_email_requested_at).getTime() < EMAIL_CHANGE_COOLDOWN_MS
    ) {
      return res.status(429).json({ error: 'A confirmation email was just sent — check that inbox first.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_HOURS * 60 * 60 * 1000);

    await pool.execute(
      `UPDATE users SET pending_email = ?, pending_email_token_hash = ?, pending_email_expires_at = ?,
       pending_email_requested_at = NOW() WHERE id = ?`,
      [normalized, tokenHash, expiresAt, req.user.id]
    );

    const confirmUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/confirm-email?token=${token}`;
    try {
      await sendEmailChangeEmail(normalized, row.first_name || row.name, confirmUrl, EMAIL_CHANGE_HOURS, req.user.email);
    } catch (err) {
      console.error('Failed to send email change confirmation', err);
      return res.status(502).json({ error: 'Could not send the confirmation email — try again shortly.' });
    }

    res.json({ pending: { email: normalized, expiresAt } });
  })
);

router.delete(
  '/email-change',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.execute(
      `UPDATE users SET pending_email = NULL, pending_email_token_hash = NULL,
       pending_email_expires_at = NULL, pending_email_requested_at = NULL WHERE id = ?`,
      [req.user.id]
    );
    res.json({ ok: true });
  })
);

// Opened from the new inbox, so it can't require a session — the person
// proving they own the address may not be signed in on that device.
router.post(
  '/confirm-email',
  asyncHandler(async (req, res) => {
    const token = req.body?.token;
    if (!token) return res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const [rows] = await pool.execute(
      `SELECT id, email, first_name, name, pending_email, pending_email_expires_at
       FROM users WHERE pending_email_token_hash = ?`,
      [tokenHash]
    );
    const user = rows[0];
    const pending = pendingEmailState(user);
    if (!user || !pending) {
      return res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
    }

    // Checked again here, not just at request time: someone else may have
    // registered the address during the 24 hours the link was valid.
    const [taken] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ?', [
      pending.pendingEmail,
      user.id,
    ]);
    if (taken.length > 0) {
      return res.status(409).json({ error: 'That address has since been registered to another account.' });
    }

    const previousEmail = user.email;

    // The token is cleared in the same statement that moves the address, so a
    // link can only ever be used once.
    try {
      await pool.execute(
        `UPDATE users SET email = ?, pending_email = NULL, pending_email_token_hash = NULL,
         pending_email_expires_at = NULL, pending_email_requested_at = NULL WHERE id = ?`,
        [pending.pendingEmail, user.id]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'That address has since been registered to another account.' });
      }
      throw err;
    }

    // The address being left behind is told, so losing a sign-in is never
    // something that happens quietly.
    try {
      await sendEmailChangedNoticeEmail(previousEmail, user.first_name || user.name, pending.pendingEmail);
    } catch (err) {
      console.error('Failed to send email change notice', err);
    }

    res.json({ ok: true, email: pending.pendingEmail, previousEmail });
  })
);

// --- Forgot password -----------------------------------------------------

const RESET_TOKEN_HOURS = 24;
const RESET_COOLDOWN_MS = 5 * 60 * 1000;

// The response is the same whether or not the address has an account. The
// sign-up form does disclose whether an email is taken — it has to, to tell
// you before you fill the rest in — but there's no reason to hand that out a
// second time from an endpoint that needs no context at all.
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email, captchaToken, captchaAnswer } = req.body || {};
    if (!verifyCaptcha(captchaToken, captchaAnswer)) {
      // Named so the form can show this under the sum rather than as a toast
      // in the opposite corner from the box it is about.
      return res.status(400).json({ error: 'That answer was not right — here is a new sum', field: 'captcha' });
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const neutral = { ok: true };

    // Only activated accounts: an account still waiting on its activation link
    // has no password to reset, and should follow that link instead.
    const [rows] = await pool.execute(
      'SELECT id, email, first_name, name, password_reset_requested_at FROM users WHERE email = ? AND activated_at IS NOT NULL',
      [normalizedEmail]
    );
    const user = rows[0];
    if (!user) return res.json(neutral);

    // Throttled so this can't be used to bombard someone's inbox. Silent —
    // saying "wait five minutes" would confirm the account exists.
    if (
      user.password_reset_requested_at &&
      Date.now() - new Date(user.password_reset_requested_at).getTime() < RESET_COOLDOWN_MS
    ) {
      return res.json(neutral);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);

    await pool.execute(
      `UPDATE users SET password_reset_token_hash = ?, password_reset_expires_at = ?,
       password_reset_requested_at = NOW() WHERE id = ?`,
      [tokenHash, expiresAt, user.id]
    );

    const resetUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
    try {
      await sendPasswordResetEmail(user.email, user.first_name || user.name, resetUrl, RESET_TOKEN_HOURS);
    } catch (err) {
      console.error('Failed to send password reset email', err);
    }

    res.json(neutral);
  })
);

async function findResetCandidate(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const [rows] = await pool.execute('SELECT * FROM users WHERE password_reset_token_hash = ?', [tokenHash]);
  const user = rows[0];
  if (!user || !user.password_reset_expires_at) return null;
  if (new Date(user.password_reset_expires_at) < new Date()) return null;
  return user;
}

// Checked before the form is shown, so nobody chooses a password only to be
// told the link had expired.
router.get(
  '/reset-password/check',
  asyncHandler(async (req, res) => {
    const user = await findResetCandidate(req.query?.token);
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    res.json({ ok: true, email: user.email });
  })
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number',
      });
    }

    const user = await findResetCandidate(token);
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

    // The token is cleared in the same statement that sets the password, so a
    // link can only ever be used once.
    await pool.execute(
      `UPDATE users SET password_hash = ?, password_reset_token_hash = NULL,
       password_reset_expires_at = NULL WHERE id = ?`,
      [hashPassword(password), user.id]
    );

    try {
      await sendPasswordChangedEmail(user.email, user.first_name || user.name);
    } catch (err) {
      console.error('Failed to send password changed email', err);
    }

    // Deliberately not signing them in. Typing the new password on the login
    // page proves it's the one they think they set, and keeps a stolen reset
    // link from handing over a live session in one click.
    res.json({ ok: true, email: user.email });
  })
);

// Hands the admin their own session back. The only write a view-as session is
// allowed to make — see requireAuth, which blocks everything else.
router.post(
  '/exit-view-as',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user.viewedBy) return res.status(400).json({ error: 'You are not viewing another account' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.viewedBy.id]);
    const admin = rows[0];
    if (!admin || !admin.is_admin) {
      res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
      return res.status(401).json({ error: 'Sign in again' });
    }

    res.cookie(COOKIE_NAME, signToken(admin), cookieOptions());
    const mfaMode = await getMfaMode();
    const publicUser = toPublicUser(admin, mfaMode);
    publicUser.accessLocked = await computeAccessLocked(publicUser);
    res.json({ user: publicUser });
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
