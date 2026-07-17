import pool from '../db.js';

function isRowActive(row) {
  if (row.subscription_status === 'active') {
    return !row.subscription_current_period_end || new Date(row.subscription_current_period_end) > new Date();
  }
  if (row.subscription_status === 'trialing') {
    return !!row.trial_ends_at && new Date(row.trial_ends_at) > new Date();
  }
  return false;
}

// Both helpers take the camelCase public-user shape (e.g. req.user) — for an
// owner, their own subscription fields govern access; for a sub-user/accountant,
// their account holder's do.
export async function computeAccessLocked(publicUser) {
  if (publicUser.role !== 'sub_user' && publicUser.role !== 'accountant') {
    return !isRowActive({
      subscription_status: publicUser.subscriptionStatus,
      subscription_current_period_end: publicUser.subscriptionCurrentPeriodEnd,
      trial_ends_at: publicUser.trialEndsAt,
    });
  }
  if (!publicUser.accountHolderId) return true;
  const [rows] = await pool.execute(
    'SELECT subscription_status, subscription_current_period_end, trial_ends_at FROM users WHERE id = ?',
    [publicUser.accountHolderId]
  );
  if (!rows[0]) return true;
  return !isRowActive(rows[0]);
}

// Returns the set of user ids whose expenses a request should see: just
// themselves for an owner/sub-user, or the whole family for an accountant.
export async function getVisibleUserIds(publicUser) {
  if (publicUser.role === 'accountant' && publicUser.accountHolderId) {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE (id = ? OR account_holder_id = ?) AND role != 'accountant'",
      [publicUser.accountHolderId, publicUser.accountHolderId]
    );
    if (rows.length > 0) return rows.map((r) => r.id);
  }
  return [publicUser.id];
}
