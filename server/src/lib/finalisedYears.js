import pool from '../db.js';
import { financialYearOf } from './financialYear.js';

// A refund arriving means the return was lodged and assessed, so the year is
// closed: editing what it contained afterwards would leave the records saying
// something different from what was actually claimed. The lock is enforced
// here rather than in each route so a handler written later can't quietly
// bypass it.

function accountOwnerId(user) {
  return user.role === 'owner' ? user.id : user.accountHolderId;
}

export async function isYearFinalised(user, financialYear) {
  const ownerId = accountOwnerId(user);
  if (!ownerId || !financialYear) return false;
  const [rows] = await pool.execute(
    'SELECT finalised_at FROM tax_years WHERE user_id = ? AND financial_year = ? AND finalised_at IS NOT NULL',
    [ownerId, financialYear]
  );
  return rows.length > 0;
}

// Every financial year currently closed for this account, so the client can
// grey out what it must not offer instead of finding out on submit.
export async function finalisedYearsFor(user) {
  const ownerId = accountOwnerId(user);
  if (!ownerId) return [];
  const [rows] = await pool.execute(
    'SELECT financial_year FROM tax_years WHERE user_id = ? AND finalised_at IS NOT NULL',
    [ownerId]
  );
  return rows.map((r) => r.financial_year);
}

// Refuses a write that would land in — or move something out of — a closed
// year. Both dates are checked because moving an expense's date across the
// boundary changes two years at once.
export async function blockIfFinalised(user, ...dates) {
  const years = Array.from(new Set(dates.filter(Boolean).map(financialYearOf).filter(Boolean)));
  for (const year of years) {
    if (await isYearFinalised(user, year)) {
      return `FY ${year} has been finalised — reopen it from Reports before changing anything in it.`;
    }
  }
  return null;
}
