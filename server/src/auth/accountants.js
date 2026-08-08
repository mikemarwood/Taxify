import pool from '../db.js';
import { notify } from '../lib/notify.js';
import { financialYearRange, isFinancialYearLabel } from '../lib/financialYear.js';
import { parseBooks } from './accountantBooks.js';

// An accountant's window opens when they first open that client's books, not
// when the client granted access — someone invited on a Friday shouldn't find
// their access gone before they started on Monday. From that first look they
// get the length the client chose, and then the assignment is deleted.
//
// An allow-list rather than a range: these values reach SQL, they are what the
// emails promise, and "some number of hours" is not a thing anyone needs.
// 168 is a week — long enough for an accountant to come back to a return
// across a weekend, which 96 hours does not always cover.
export const ACCOUNTANT_WINDOW_CHOICES = [24, 48, 72, 96, 168];
export const ACCOUNTANT_WINDOW_HOURS = 24;

export function normaliseWindowHours(value) {
  const n = Number(value);
  return ACCOUNTANT_WINDOW_CHOICES.includes(n) ? n : null;
}

// "24 hours", "2 days" — the emails and the UI both need to say it, and saying
// it two different ways in two places is how they end up disagreeing.
export function describeWindow(hours) {
  const n = normaliseWindowHours(hours) ?? ACCOUNTANT_WINDOW_HOURS;
  return n === 24 ? '24 hours' : `${n / 24} days`;
}

function parseYears(value) {
  if (!value) return null;
  const list = String(value)
    .split(',')
    .map((y) => y.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

// What serialiseYears should always have been.
//
// serialiseYears returns null when every label is rejected, and null means "the
// whole history" — so a client who picks three years and mistypes all three
// silently grants everything, and the response says nothing. Meanwhile
// financialYearClause fails *closed* at read time. The two have to agree, and
// the safe one has to win.
//
// The caller must say which it means: { allYears: true } or a list. "Omitted"
// and "all rejected" arrive at the server identically otherwise.
const MAX_GRANTED_YEARS = 20;

export function parseYearGrant(input) {
  if (input === null || input === undefined) return { ok: true, value: null, rejected: [] };
  // A bare string would iterate one character at a time and reject all of them,
  // which lands on the fail-open path. Refused outright instead.
  if (!Array.isArray(input)) return { ok: false, value: null, rejected: [String(input)] };
  if (input.length === 0) return { ok: true, value: null, rejected: [] };
  if (input.length > MAX_GRANTED_YEARS) {
    // financial_years is VARCHAR(255). Truncation here would silently reshape
    // somebody's access, so the request is refused rather than trimmed.
    return { ok: false, value: null, rejected: [], tooMany: true };
  }

  const seen = new Set();
  const accepted = [];
  const rejected = [];
  for (const raw of input) {
    const year = String(raw).trim();
    if (!isFinancialYearLabel(year)) {
      rejected.push(year);
      continue;
    }
    if (seen.has(year)) continue;
    seen.add(year);
    accepted.push(year);
  }

  if (accepted.length === 0) return { ok: false, value: null, rejected };
  return { ok: true, value: accepted.join(','), rejected };
}

export function serialiseYears(years) {
  if (!Array.isArray(years) || years.length === 0) return null;
  // isFinancialYearLabel, not a hyphenated-only pattern. A country whose tax
  // year is the calendar year labels it "2025", and the stricter test silently
  // dropped every year an American or Irish client tried to grant — leaving an
  // accountant with an empty list, which means no restriction at all.
  const cleaned = Array.from(new Set(years.map((y) => String(y).trim()).filter(isFinancialYearLabel)));
  return cleaned.length > 0 ? cleaned.join(',') : null;
}

// Rows past their window grant nothing, and every read below carries this so
// that stays true between sweeps.
//
// It used to be a DELETE run from inside those same reads, which meant an
// assignment could vanish mid-request and there was no single moment anyone
// could announce. Deletion moved to closeExpiredAssignments, which tells both
// people first — so "removed when the window ends" is still true of the
// database, it just no longer happens where nobody is looking.
//
// expires_at IS NULL means NOT OPENED YET, which is valid and grants normally.
// Reading it as expired locks every accountant out before they start.
const LIVE_ASSIGNMENT = '(a.expires_at IS NULL OR a.expires_at > NOW())';

export async function purgeExpiredAssignments() {
  const [result] = await pool.execute(
    'DELETE FROM accountant_assignments WHERE expires_at IS NOT NULL AND expires_at < NOW()'
  );
  return result.affectedRows || 0;
}

export async function listAssignments(accountantUserId) {
  const [rows] = await pool.execute(
    `SELECT a.id, a.owner_user_id, a.financial_years, a.entity_ids, a.access_level, a.window_hours, a.first_login_at, a.expires_at, a.created_at,
            o.name, o.email, o.business_name, o.currency
     FROM accountant_assignments a
     JOIN users o ON o.id = a.owner_user_id
     WHERE a.accountant_user_id = ? AND ${LIVE_ASSIGNMENT}
     ORDER BY o.name`,
    [accountantUserId]
  );
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_user_id,
    name: r.name,
    email: r.email,
    businessName: r.business_name || null,
    currency: r.currency || 'AUD',
    financialYears: parseYears(r.financial_years),
    entityIds: parseBooks(r.entity_ids),
    canWrite: r.access_level === 'write',
    windowHours: normaliseWindowHours(r.window_hours) ?? ACCOUNTANT_WINDOW_HOURS,
    firstLoginAt: r.first_login_at,
    expiresAt: r.expires_at,
    grantedAt: r.created_at,
  }));
}

// Called when an accountant actually opens a client. Starts the clock the
// first time and does nothing on every visit after that.
export async function openAssignment(accountantUserId, ownerUserId) {
  const [rows] = await pool.execute(
    `SELECT a.id, a.first_login_at, a.expires_at, a.financial_years, a.window_hours
     FROM accountant_assignments a
     WHERE a.accountant_user_id = ? AND a.owner_user_id = ? AND ${LIVE_ASSIGNMENT}`,
    [accountantUserId, ownerUserId]
  );
  const row = rows[0];
  if (!row) return null;

  if (!row.first_login_at) {
    const hours = normaliseWindowHours(row.window_hours) ?? ACCOUNTANT_WINDOW_HOURS;
    // Bound, not interpolated. It was a module constant before and could only
    // ever be 24; now it comes from a row that a request wrote, and a value
    // from a request belongs in a parameter even when an allow-list already
    // guarantees it is a number.
    await pool.execute(
      `UPDATE accountant_assignments
       SET first_login_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
       WHERE id = ?`,
      [hours, row.id]
    );
    const [fresh] = await pool.execute('SELECT first_login_at, expires_at FROM accountant_assignments WHERE id = ?', [
      row.id,
    ]);
    // Flagged so the caller can tell the client their books have been opened.
    // Only on the first look — an accountant coming back four times in a day
    // should not send four notifications.
    return { ...row, ...fresh[0], financialYears: parseYears(row.financial_years), firstOpen: true };
  }

  return { ...row, financialYears: parseYears(row.financial_years), firstOpen: false };
}

// Whether this login acts for anybody. Being an accountant is no longer a role
// someone is instead of being a normal user — it is simply having clients, so
// an account holder who also does other people's books is one login with both.
export async function hasAssignments(userId) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM accountant_assignments a WHERE a.accountant_user_id = ? AND ${LIVE_ASSIGNMENT} LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

export async function findAssignment(accountantUserId, ownerUserId) {
  const [rows] = await pool.execute(
    `SELECT a.id, a.financial_years, a.entity_ids, a.access_level, a.window_hours, a.first_login_at, a.expires_at
     FROM accountant_assignments a
     WHERE a.accountant_user_id = ? AND a.owner_user_id = ? AND ${LIVE_ASSIGNMENT}`,
    [accountantUserId, ownerUserId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    financialYears: parseYears(row.financial_years),
    // null means every set of books. Read here so the middleware has it on
    // every request, the same as the years.
    entityIds: parseBooks(row.entity_ids),
    // 'write' only when it says so. Anything else, including a value somebody
    // put there by hand, reads as 'read'.
    canWrite: row.access_level === 'write',
    windowHours: normaliseWindowHours(row.window_hours) ?? ACCOUNTANT_WINDOW_HOURS,
    firstLoginAt: row.first_login_at,
    expiresAt: row.expires_at,
  };
}

// The sweep that actually removes them, run on a timer rather than from inside
// a read. Both people are told before the row goes: the accountant because
// their client just disappeared from the list, the client because somebody
// finished looking at their books.
export async function closeExpiredAssignments(notify) {
  const [rows] = await pool.execute(
    `SELECT a.id, a.accountant_user_id, a.owner_user_id, o.name AS owner_name, c.name AS accountant_name
     FROM accountant_assignments a
     JOIN users o ON o.id = a.owner_user_id
     JOIN users c ON c.id = a.accountant_user_id
     WHERE a.expires_at IS NOT NULL AND a.expires_at < NOW()`
  );
  if (rows.length === 0) return 0;

  for (const row of rows) {
    if (typeof notify === 'function') {
      await notify(row.accountant_user_id, {
        title: `Your access to ${row.owner_name}'s books has ended`,
        body: 'The window closed. Ask them to share it again whenever you need another look.',
        url: '/clients',
        kind: 'accountant',
      }).catch(() => {});
      await notify(row.owner_user_id, {
        title: `${row.accountant_name}'s access has ended`,
        body: 'Their window closed and the access was removed automatically.',
        url: '/account',
        kind: 'accountant',
      }).catch(() => {});
    }
  }

  const [result] = await pool.query(
    `DELETE FROM accountant_assignments WHERE id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id)
  );
  return result.affectedRows || 0;
}

// A SQL fragment restricting rows to the financial years an accountant was
// given. Returns null when there is nothing to restrict, so callers can leave
// their query alone rather than appending a clause that is always true.
export function financialYearClause(years, column = 'e.purchase_date', rule = undefined) {
  if (!years || years.length === 0) return null;
  // The client's own rule, not Australia's. Granted "2025" on a calendar-year
  // account, this used to hand back 1 July 2025 – 30 June 2026: half a year the
  // accountant was never given, and half the year they were, missing.
  //
  // Also note the explicit arrow. `years.map(financialYearRange)` passed the
  // array index as the second argument, so element 2 asked for a rule of `2`.
  const ranges = years.map((y) => financialYearRange(y, rule)).filter(Boolean);
  // A scope that was set but parsed to nothing means something is wrong with
  // the stored value. Showing everything would be the worst possible reading
  // of "they were only given 2024-2025", so it shows nothing instead.
  if (ranges.length === 0) return { clause: '1 = 0', params: [] };
  return {
    clause: `(${ranges.map(() => `(${column} >= ? AND ${column} <= ?)`).join(' OR ')})`,
    params: ranges.flatMap((r) => [r.start, r.end]),
  };
}
