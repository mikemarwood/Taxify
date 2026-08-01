import pool from '../db.js';
import { financialYearClause } from './accountants.js';

function isRowActive(row) {
  // An admin can hand an account access without a subscription — a comped
  // account, a support case, someone whose payment is still being sorted out.
  // Checked first, so it outranks an expired trial or a lapsed card.
  if (row.access_bypass) {
    return !row.access_bypass_until || new Date(row.access_bypass_until) > new Date();
  }
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
      access_bypass: publicUser.accessBypass,
      access_bypass_until: publicUser.accessBypassUntil,
    });
  }
  if (!publicUser.accountHolderId) return true;
  const [rows] = await pool.execute(
    `SELECT subscription_status, subscription_current_period_end, trial_ends_at,
            access_bypass, access_bypass_until
     FROM users WHERE id = ?`,
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

// The whole WHERE fragment for "expenses this request may read" — the user ids
// plus, for an accountant given only some financial years, the date ranges
// those years cover. Built in one place so a query written later can't
// accidentally hand an accountant a year they were never given.
export async function expenseScope(publicUser, column = 'e.user_id', dateColumn = 'e.purchase_date') {
  const ids = await getVisibleUserIds(publicUser);
  const parts = [`${column} IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];

  const years = publicUser.role === 'accountant' ? publicUser.allowedFinancialYears : null;
  const restriction = financialYearClause(years, dateColumn);
  if (restriction) {
    parts.push(restriction.clause);
    params.push(...restriction.params);
  }

  return { ids, clause: parts.join(' AND '), params };
}
