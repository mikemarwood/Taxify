import { Router } from 'express';
import pool, { getSetting } from '../db.js';
import { hashPassword, verifyPassword, isStrongPassword } from '../auth/password.js';
import { signToken, cookieOptions, COOKIE_NAME } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';
import { asyncHandler } from '../lib/asyncHandler.js';

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
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: false } });
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
    res.json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin } });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
