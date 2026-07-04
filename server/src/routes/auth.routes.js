import { Router } from 'express';
import db from '../db.js';
import { hashPassword, verifyPassword, isStrongPassword } from '../auth/password.js';
import { signToken, cookieOptions, COOKIE_NAME } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';

const router = Router();

router.post('/register', (req, res) => {
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
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash = hashPassword(password);
  const insert = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)');
  const info = insert.run(normalizedEmail, passwordHash, String(name).trim());
  seedDefaultCategories(db, info.lastInsertRowid);

  const user = { id: info.lastInsertRowid, email: normalizedEmail, name };
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
