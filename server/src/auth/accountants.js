import pool from '../db.js';
import { financialYearRange } from '../lib/financialYear.js';

// An accountant's window opens when they first open that client's books, not
// when the client granted access — someone invited on a Friday shouldn't find
// their access gone before they started on Monday. From that first look they
// get one day, and then the assignment is deleted.
export const ACCOUNTANT_WINDOW_HOURS = 24;

function parseYears(value) {
  if (!value) return null;
  const list = String(value)
    .split(',')
    .map((y) => y.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

export function serialiseYears(years) {
  if (!Array.isArray(years) || years.length === 0) return null;
  const cleaned = Array.from(new Set(years.map((y) => String(y).trim()).filter((y) => /^\d{4}-\d{4}$/.test(y))));
  return cleaned.length > 0 ? cleaned.join(',') : null;
}

// Expired rows are deleted rather than filtered, so "removed after 24 hours"
// is true of the database and not just of what the app happens to query.
export async function purgeExpiredAssignments() {
  const [result] = await pool.execute(
    'DELETE FROM accountant_assignments WHERE expires_at IS NOT NULL AND expires_at < NOW()'
  );
  return result.affectedRows || 0;
}

export async function listAssignments(accountantUserId) {
  await purgeExpiredAssignments();
  const [rows] = await pool.execute(
    `SELECT a.id, a.owner_user_id, a.financial_years, a.first_login_at, a.expires_at, a.created_at,
            o.name, o.email, o.business_name, o.currency
     FROM accountant_assignments a
     JOIN users o ON o.id = a.owner_user_id
     WHERE a.accountant_user_id = ?
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
    firstLoginAt: r.first_login_at,
    expiresAt: r.expires_at,
    grantedAt: r.created_at,
  }));
}

// Called when an accountant actually opens a client. Starts the clock the
// first time and does nothing on every visit after that.
export async function openAssignment(accountantUserId, ownerUserId) {
  await purgeExpiredAssignments();
  const [rows] = await pool.execute(
    'SELECT id, first_login_at, expires_at, financial_years FROM accountant_assignments WHERE accountant_user_id = ? AND owner_user_id = ?',
    [accountantUserId, ownerUserId]
  );
  const row = rows[0];
  if (!row) return null;

  if (!row.first_login_at) {
    await pool.execute(
      `UPDATE accountant_assignments
       SET first_login_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ${ACCOUNTANT_WINDOW_HOURS} HOUR)
       WHERE id = ?`,
      [row.id]
    );
    const [fresh] = await pool.execute('SELECT first_login_at, expires_at FROM accountant_assignments WHERE id = ?', [
      row.id,
    ]);
    return { ...row, ...fresh[0], financialYears: parseYears(row.financial_years) };
  }

  return { ...row, financialYears: parseYears(row.financial_years) };
}

export async function findAssignment(accountantUserId, ownerUserId) {
  await purgeExpiredAssignments();
  const [rows] = await pool.execute(
    'SELECT id, financial_years, first_login_at, expires_at FROM accountant_assignments WHERE accountant_user_id = ? AND owner_user_id = ?',
    [accountantUserId, ownerUserId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    financialYears: parseYears(row.financial_years),
    firstLoginAt: row.first_login_at,
    expiresAt: row.expires_at,
  };
}

// A SQL fragment restricting rows to the financial years an accountant was
// given. Returns null when there is nothing to restrict, so callers can leave
// their query alone rather than appending a clause that is always true.
export function financialYearClause(years, column = 'e.purchase_date') {
  if (!years || years.length === 0) return null;
  const ranges = years.map(financialYearRange).filter(Boolean);
  // A scope that was set but parsed to nothing means something is wrong with
  // the stored value. Showing everything would be the worst possible reading
  // of "they were only given 2024-2025", so it shows nothing instead.
  if (ranges.length === 0) return { clause: '1 = 0', params: [] };
  return {
    clause: `(${ranges.map(() => `(${column} >= ? AND ${column} <= ?)`).join(' OR ')})`,
    params: ranges.flatMap((r) => [r.start, r.end]),
  };
}
