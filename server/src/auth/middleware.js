import { verifyToken, COOKIE_NAME } from './jwt.js';
import pool, { getMfaMode } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toPublicUser } from './publicUser.js';
import { computeAccessLocked, dataOwnerId, financialYearRuleFor } from './access.js';
import { findAssignment, hasAssignments } from './accountants.js';
import { accountantSetupState, blocksExistingSession } from './accountantOnboarding.js';
import { resolveRequestEntity } from '../lib/entityScope.js';
import { touchLastSeen } from '../lib/presence.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });

  const [rows] = await pool.execute(
    `SELECT id, email, name, first_name, last_name, date_of_birth, phone, is_admin, is_support, avatar_path,
            otp_enabled, otp_last_prompted_at, role, account_holder_id, plan_type,
            fy_start_month, fy_start_day,
            currency, country, state, business_name, practice_name, activated_at, trial_ends_at,
            access_bypass, access_bypass_until,
            subscription_status, stripe_customer_id, stripe_subscription_id, subscription_current_period_end
     FROM users WHERE id = ?`,
    [payload.sub]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const mfaMode = await getMfaMode();
  req.user = toPublicUser(user, mfaMode);

  // Not awaited. Presence is a statistic; nobody's request should wait on it,
  // and nobody's request should fail because of it. Recorded against the
  // signed-in account rather than dataOwnerId — an accountant reading a
  // client's books is the one who is here, not the client.
  touchLastSeen(user.id);

  // Acting for a client is a property of the *session*, not of the user. The
  // same login can be an account holder tracking their own expenses and an
  // accountant doing someone else's books — which hat they are wearing right
  // now is whether the token names a client.
  req.user.isAccountant = await hasAssignments(req.user.id);
  req.user.actingAsClient = null;
  req.user.allowedFinancialYears = null;
  // null means every set of books. Only ever narrowed for a session that is
  // inside a client, the same as the years above.
  req.user.allowedEntityIds = null;

  // What they still have to do before they may act for anybody. Published on
  // req.user so /auth/me carries it to the client without a route of its own.
  req.user.accountantSetup = accountantSetupState({
    isAccountant: req.user.isAccountant,
    otpEnabled: req.user.otpEnabled,
    practiceName: req.user.practiceName,
  });

  if (payload.clientId && blocksExistingSession(req.user.accountantSetup)) {
    // Dropped rather than refused, and dropped *here* — before the year rule,
    // the entity and accessLocked are all resolved against a client. Every
    // scope function downstream then behaves as though no client is open, so a
    // route written next year cannot read a client's records even if its author
    // never heard of this rule. A 403 would only stop the routes that thought
    // to check.
    //
    // This is the one thing that can end a session that is already open, and it
    // can only happen to somebody who turned their own two-factor off.
  } else if (payload.clientId) {
    const assignment = await findAssignment(req.user.id, payload.clientId);
    // A revoked or expired assignment drops the client from the session at
    // once — they land back on the picker rather than on stale books.
    if (assignment) {
      const [ownerRows] = await pool.execute('SELECT id, name, email, business_name FROM users WHERE id = ?', [
        payload.clientId,
      ]);
      if (ownerRows[0]) {
        req.user.allowedFinancialYears = assignment.financialYears;
      req.user.allowedEntityIds = assignment.entityIds;
        req.user.actingAsClient = {
          id: ownerRows[0].id,
          name: ownerRows[0].name,
          email: ownerRows[0].email,
          businessName: ownerRows[0].business_name || null,
          financialYears: assignment.financialYears,
          canWrite: assignment.canWrite,
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

  // Which set of books. Resolved here, beside the year rule, for the same
  // reason: one place, so a query written next year is scoped whether or not
  // its author thought about entities.
  const books = await resolveRequestEntity(req);
  if (books.invalid) {
    // Never quietly widened to "everything". A stale id from a previous account
    // must fail loudly enough for the client to clear it.
    return res.status(403).json({ error: 'entity_not_yours' });
  }
  req.user.entityId = books.id;
  req.user.entity = books.entity;

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

    // The two ways out. Everything else is refused, but a support session
    // has to be leavable — refusing the exit or the sign-out would trap an
    // administrator inside somebody else's account with the only escape being
    // to clear cookies by hand.
    const isWayOut =
      req.originalUrl.includes('/auth/exit-view-as') || req.originalUrl.includes('/auth/logout');
    if (req.method !== 'GET' && !isWayOut) {
      return res.status(403).json({ error: 'You are viewing this account as an administrator — it is read-only.' });
    }
  }

  next();
});

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// The support queue, and only that.
//
// An administrator qualifies because they can already do everything this
// allows. Support staff qualify for these routes and no others — which is the
// entire point of the flag, so it must never be widened into a general admin
// check by somebody looking for a shorter line to write.
export function requireSupportStaff(req, res, next) {
  if (!req.user?.isAdmin && !req.user?.isSupport) {
    return res.status(403).json({ error: 'Support access required' });
  }
  next();
}

export function requireActiveAccess(req, res, next) {
  // Inside a client's books: read-only, and governed by that client's
  // subscription rather than the accountant's own.
  if (req.user?.actingAsClient) {
    if (req.user.accessLocked) return res.status(403).json({ error: 'subscription_required' });
    // An assignment may be granted write access to the books it covers. Where
    // it has not been, this stays exactly as strict as it always was.
    //
    // What write never includes, whatever the client chose:
    //
    //   Deleting a set of books. That destroys every expense, receipt and
    //   lodgement inside it, and it is not the kind of thing somebody hands to
    //   a contractor along with permission to fix a receipt.
    //
    //   Anything about the account itself — billing, plan, accountant access,
    //   the client's own login. Those are guarded separately by
    //   requireAccountOwner, which refuses anybody with a client open
    //   regardless of this flag.
    if (!req.user.actingAsClient.canWrite && req.method !== 'GET') {
      return res.status(403).json({ error: 'Accountant access is read-only' });
    }
    if (req.method === 'DELETE' && /^\/api\/entities\//.test(req.originalUrl)) {
      return res.status(403).json({ error: 'An accountant cannot delete a set of books' });
    }
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

// Attaches req.user when there is a valid session, and does nothing when there
// is not. For routes that serve both — raising a support ticket is the case it
// was written for, where somebody who cannot sign in is exactly who most needs
// to reach us, but a signed-in customer should not have to retype their name
// and address.
//
// Deliberately thin: it does not resolve books, years or accessLocked, because
// a route open to the public has no business acting on any of them. Anything
// needing those asks for requireAuth instead.
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return next();

  const [rows] = await pool.execute(
    'SELECT id, email, name, first_name, last_name, is_admin, avatar_path, role FROM users WHERE id = ?',
    [payload.sub]
  );
  if (rows[0]) {
    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      name: rows[0].name,
      isAdmin: Boolean(rows[0].is_admin),
      role: rows[0].role,
    };
    touchLastSeen(rows[0].id);
  }
  next();
});
