import { verifyToken, COOKIE_NAME } from './jwt.js';
import db from '../db.js';

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });

  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(payload.sub);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  req.user = user;
  next();
}
