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
        'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
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
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: false, avatarUrl: null } });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: !!user.is_admin,
        avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
      },
    });
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
