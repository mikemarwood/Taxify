import { verifyToken, COOKIE_NAME } from './jwt.js';
import pool from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });

  const [rows] = await pool.execute(
    'SELECT id, email, name, is_admin, avatar_path, otp_enabled, otp_prompted FROM users WHERE id = ?',
    [payload.sub]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: !!user.is_admin,
    avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
    otpEnabled: !!user.otp_enabled,
    otpPrompted: !!user.otp_prompted,
  };
  next();
});

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}
