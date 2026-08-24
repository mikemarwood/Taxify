import pool from '../db.js';
import { verifyToken, COOKIE_NAME } from '../auth/jwt.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isAlwaysAllowed } from '../lib/maintenance.js';
import { currentMaintenanceNotice } from '../lib/maintenanceSettings.js';

// Holds the door shut for everybody except an admin.
//
// Mounted in front of the API routers rather than inside each one, because a
// route that forgot to opt in would be a hole in the middle of an outage — and
// the list of routes only ever grows.
//
// It answers 503 rather than redirecting. A redirect would lose whatever the
// request was carrying, and this fires against a running app: somebody is
// mid-save when the switch is thrown, and the honest answer to "save this" is
// "not now", not a page navigation that throws their typing away. The client
// turns the 503 into the notice screen.

// Its own query, not requireAuth's.
//
// requireAuth reads thirty columns, resolves accountant assignments, touches
// presence and computes access locks. None of that is needed to answer "may
// this person through", it would run on every request during an outage, and
// half of it writes. One column, by primary key.
async function requesterIsAdmin(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return false;
  const payload = verifyToken(token);
  if (!payload?.sub) return false;
  try {
    const [rows] = await pool.execute('SELECT is_admin FROM users WHERE id = ?', [payload.sub]);
    return Boolean(rows[0]?.is_admin);
  } catch {
    // The database being unreachable is not a reason to let everybody in.
    return false;
  }
}

export const maintenanceGate = asyncHandler(async (req, res, next) => {
  const notice = await currentMaintenanceNotice();
  if (!notice) return next();
  if (isAlwaysAllowed(req.path)) return next();
  if (await requesterIsAdmin(req)) return next();

  // An hour is a guess, and it is the point of the header rather than a
  // promise: it stops well-behaved clients and crawlers retrying in a tight
  // loop against a site that is deliberately down.
  res.set('Retry-After', '3600');
  res.set('Cache-Control', 'no-store');
  return res.status(503).json({ error: notice.heading, maintenance: notice });
});

// The public status endpoint.
//
// Never gated — the sign-in page asks it so it can explain itself instead of
// showing a bare failure, and an admin's own screen asks it to know whether
// the switch it is showing is really in force.
export const maintenanceStatus = asyncHandler(async (req, res) => {
  const notice = await currentMaintenanceNotice();
  res.set('Cache-Control', 'no-store');
  res.json({ maintenance: notice });
});
