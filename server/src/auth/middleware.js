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
    `SELECT id, email, name, first_name, last_name, date_of_birth, phone, is_admin, avatar_path,
            otp_enabled, otp_last_prompted_at, role, account_holder_id, plan_type,
            currency, country, state, business_name, activated_at, trial_ends_at,
            access_bypass, access_bypass_until,
            subscription_status, stripe_customer_id, stripe_subscription_id, subscription_current_period_end
     FROM users WHERE id = ?`,
    [payload.sub]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const mfaMode = await getMfaMode();
  req.user = toPublicUser(user, mfaMode);
  req.user.accessLocked = await computeAccessLocked(req.user);

  // An admin viewing someone else's account. Enforced here rather than in each
  // route because "read-only" has to mean every route, including ones written
  // later that nobody thought about — a support tool that can quietly edit a
  // customer's records is worse than no support tool.
  if (payload.viewedBy) {
    const [adminRows] = await pool.execute('SELECT id, name, email, is_admin FROM users WHERE id = ?', [
      payload.viewedBy,
    ]);
    const admin = adminRows[0];
    // Admin rights removed since the session started ends it immediately.
    if (!admin || !admin.is_admin) return res.status(401).json({ error: 'Not authenticated' });

    req.user.viewedBy = { id: admin.id, name: admin.name, email: admin.email };
    req.user.readOnly = true;

    const isExit = req.originalUrl.includes('/auth/exit-view-as');
    if (req.method !== 'GET' && !isExit) {
      return res.status(403).json({ error: 'You are viewing this account as an administrator — it is read-only.' });
    }
  }

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
