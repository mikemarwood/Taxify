import { verifyToken, COOKIE_NAME } from './jwt.js';
import pool, { getMfaMode } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toPublicUser } from './publicUser.js';
import { computeAccessLocked, dataOwnerId, financialYearRuleFor } from './access.js';
import { findAssignment, hasAssignments } from './accountants.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });

  const [rows] = await pool.execute(
    `SELECT id, email, name, first_name, last_name, date_of_birth, phone, is_admin, avatar_path,
            otp_enabled, otp_last_prompted_at, role, account_holder_id, plan_type,
            fy_start_month, fy_start_day,
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

  // Acting for a client is a property of the *session*, not of the user. The
  // same login can be an account holder tracking their own expenses and an
  // accountant doing someone else's books — which hat they are wearing right
  // now is whether the token names a client.
  req.user.isAccountant = await hasAssignments(req.user.id);
  req.user.actingAsClient = null;
  req.user.allowedFinancialYears = null;

  if (payload.clientId) {
    const assignment = await findAssignment(req.user.id, payload.clientId);
    // A revoked or expired assignment drops the client from the session at
    // once — they land back on the picker rather than on stale books.
    if (assignment) {
      const [ownerRows] = await pool.execute('SELECT id, name, email, business_name FROM users WHERE id = ?', [
        payload.clientId,
      ]);
      if (ownerRows[0]) {
        req.user.allowedFinancialYears = assignment.financialYears;
        req.user.actingAsClient = {
          id: ownerRows[0].id,
          name: ownerRows[0].name,
          email: ownerRows[0].email,
          businessName: ownerRows[0].business_name || null,
          financialYears: assignment.financialYears,
          expiresAt: assignment.expiresAt,
        };
      }
    }
  }

  // Kept for the client, which reads `activeClient`.
  req.user.activeClient = req.user.actingAsClient;

  // Which twelve months count as a year here. It belongs to the account whose
  // books are open — an Australian accountant reading a British client's
  // records must see them filed the British way, not their own.
  req.user.financialYearRule = await financialYearRuleFor(dataOwnerId(req.user));

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
  // Inside a client's books: read-only, and governed by that client's
  // subscription rather than the accountant's own.
  if (req.user?.actingAsClient) {
    if (req.user.accessLocked) return res.status(403).json({ error: 'subscription_required' });
    if (req.method !== 'GET') return res.status(403).json({ error: 'Accountant access is read-only' });
    return next();
  }

  // Someone invited purely as an accountant has no books of their own yet, so
  // there is nothing here for them until they either open a client or start
  // their own account. Said distinctly so the app sends them to the picker
  // rather than to a "subscription required" wall that isn't their problem.
  if (req.user?.role === 'accountant') {
    return res.status(409).json({ error: 'select_client' });
  }

  // Otherwise these are their own books, under their own subscription — the
  // same rules as any other account holder, whether or not they also do
  // somebody else's tax.
  if (req.user?.accessLocked) {
    return res.status(403).json({ error: 'subscription_required' });
  }
  next();
}

export function requireAccountOwner(req, res, next) {
  // An accountant inside a client is never the account holder, whatever their
  // own role says — otherwise someone with their own account could act as the
  // owner of a client they are merely visiting.
  if (req.user?.actingAsClient || req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Only the account holder can do this' });
  }
  next();
}
