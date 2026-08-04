import pool from '../db.js';
import { financialYearClause } from './accountants.js';
import { normaliseRule, DEFAULT_RULE } from '../lib/financialYear.js';

// The financial-year rule of a given account. Cached per request by the caller
// rather than here — this is one small indexed read.
export async function financialYearRuleFor(userId) {
  if (!userId) return DEFAULT_RULE;
  const [rows] = await pool.execute('SELECT fy_start_month, fy_start_day FROM users WHERE id = ?', [userId]);
  if (!rows[0]) return DEFAULT_RULE;
  return normaliseRule({ startMonth: rows[0].fy_start_month, startDay: rows[0].fy_start_day });
}

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
  // Inside a client's books it is the client's subscription that governs —
  // an accountant is never billed for looking, and their own subscription (or
  // lack of one) says nothing about whether their client has paid.
  const governingId = publicUser.actingAsClient
    ? publicUser.actingAsClient.id
    : publicUser.role === 'sub_user'
    ? publicUser.accountHolderId
    : null;

  if (governingId === null) {
    // An accountant who has not started their own account has no subscription
    // to judge; their client work is governed above and everything else is
    // limited to their own profile.
    if (publicUser.role === 'accountant') return true;
    return !isRowActive({
      subscription_status: publicUser.subscriptionStatus,
      subscription_current_period_end: publicUser.subscriptionCurrentPeriodEnd,
      trial_ends_at: publicUser.trialEndsAt,
      access_bypass: publicUser.accessBypass,
      access_bypass_until: publicUser.accessBypassUntil,
    });
  }

  if (!governingId) return true;
  const [rows] = await pool.execute(
    `SELECT subscription_status, subscription_current_period_end, trial_ends_at,
            access_bypass, access_bypass_until
     FROM users WHERE id = ?`,
    [governingId]
  );
  if (!rows[0]) return true;
  return !isRowActive(rows[0]);
}

// The account a request is *about*. This is the single place that decides it,
// because the same login can now be an account holder and somebody else's
// accountant — and reading their own id while they are inside a client's books
// would quietly write one person's tax records into another's.
export function dataOwnerId(publicUser) {
  if (publicUser.actingAsClient) return publicUser.actingAsClient.id;
  if (publicUser.role === 'sub_user') return publicUser.accountHolderId;
  return publicUser.id;
}

// Returns the set of user ids whose expenses a request should see: just
// themselves normally, or the whole family of the client an accountant has open.
export async function getVisibleUserIds(publicUser) {
  if (publicUser.actingAsClient) {
    const ownerId = publicUser.actingAsClient.id;
    // The client, plus the family members who share their books. Stated as
    // exactly that rather than as "everyone attached to them, except
    // accountants" — an accountant who later starts their own account stops
    // being an accountant by role while still carrying account_holder_id, and
    // an exclusion phrased that way would quietly hand their private expenses
    // to the client they were invited by.
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE id = ? OR (account_holder_id = ? AND role = 'sub_user')",
      [ownerId, ownerId]
    );
    if (rows.length > 0) return rows.map((r) => r.id);
    return [ownerId];
  }
  return [publicUser.id];
}

// The whole WHERE fragment for "expenses this request may read" — the user ids
// plus, for an accountant given only some financial years, the date ranges
// those years cover. Built in one place so a query written later can't
// accidentally hand an accountant a year they were never given.
export async function expenseScope(
  publicUser,
  column = 'e.user_id',
  dateColumn = 'e.purchase_date',
  entityColumn = 'e.entity_id'
) {
  const ids = await getVisibleUserIds(publicUser);
  const parts = [`${column} IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];

  // A chosen set of books narrows the request to it. Because requireAuth put
  // the choice on req.user, every caller of this function became entity-aware
  // without changing a line — including ones written after this comment.
  // Absent means the combined view, which is a way of looking rather than a
  // place to file, so reads allow it and writes do not.
  if (publicUser.entityId) {
    parts.push(`${entityColumn} = ?`);
    params.push(publicUser.entityId);
  }

  const years = publicUser.actingAsClient ? publicUser.allowedFinancialYears : null;
  // The rule is the data owner's, set on req.user by requireAuth — so a year
  // grant is converted to dates using the client's own tax year, not ours.
  const restriction = financialYearClause(years, dateColumn, publicUser.financialYearRule);
  if (restriction) {
    parts.push(restriction.clause);
    params.push(...restriction.params);
  }

  return { ids, clause: parts.join(' AND '), params };
}
