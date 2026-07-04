import { verifyToken, COOKIE_NAME } from './jwt.js';
import pool from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });

  const [rows] = await pool.execute('SELECT id, email, name FROM users WHERE id = ?', [payload.sub]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  req.user = user;
  next();
});
