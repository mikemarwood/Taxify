import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool, { getSetting } from '../db.js';
import { hashPassword, verifyPassword, isStrongPassword } from '../auth/password.js';
import { signToken, cookieOptions, COOKIE_NAME } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { generateOtp, hashOtp, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS, OTP_LOCKOUT_MINUTES } from '../auth/otp.js';
import { sendOtpEmail } from '../lib/mailer.js';

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: !!user.is_admin,
    avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
    otpEnabled: true,
    otpPrompted: true,
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const avatarsDir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
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

    const { email, password, name } = req.body || {};

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number',
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);

    let userId;
    try {
      const [result] = await pool.execute(
        'INSERT INTO users (email, password_hash, name, otp_enabled, otp_prompted) VALUES (?, ?, ?, 1, 1)',
        [normalizedEmail, passwordHash, String(name).trim()]
      );
      userId = result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      throw err;
    }

    await seedDefaultCategories(pool, userId);

    const user = { id: userId, email: normalizedEmail, name };
    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: false,
        avatarUrl: null,
        otpEnabled: true,
        otpPrompted: true,
      },
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

    if (user.otp_locked_until && new Date(user.otp_locked_until) > new Date()) {
      return res.status(423).json({
        error: 'Too many incorrect codes. Login is temporarily locked.',
        lockedUntil: user.otp_locked_until,
      });
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
    res.json({ user: toPublicUser(user) });
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

export default router;
