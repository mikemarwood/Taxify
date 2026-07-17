import { verifyToken, COOKIE_NAME } from './jwt.js';
import pool, { getMfaMode } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toPublicUser } from './publicUser.js';
import { computeAccessLocked } from './access.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });

  const [rows] = await pool.execute(
    `SELECT id, email, name, is_admin, avatar_path, otp_enabled, otp_last_prompted_at,
            role, account_holder_id, plan_type, activated_at, trial_ends_at,
            subscription_status, stripe_customer_id, stripe_subscription_id, subscription_current_period_end
     FROM users WHERE id = ?`,
    [payload.sub]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const mfaMode = await getMfaMode();
  req.user = toPublicUser(user, mfaMode);
  req.user.accessLocked = await computeAccessLocked(req.user);
  next();
});

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

export function requireActiveAccess(req, res, next) {
  if (req.user?.accessLocked) {
    return res.status(403).json({ error: 'subscription_required' });
  }
  if (req.user?.role === 'accountant' && req.method !== 'GET') {
    return res.status(403).json({ error: 'Accountant access is read-only' });
  }
  next();
}

export function requireAccountOwner(req, res, next) {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Only the account holder can do this' });
  }
  next();
}
