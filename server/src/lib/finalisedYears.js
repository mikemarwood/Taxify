import pool from '../db.js';
import { lodgementPeriodsFor, normaliseCadence, periodsCovering } from './lodgementPeriods.js';
// Whose year is being locked: the client's when an accountant is inside their
// books, otherwise the reader's own account. One definition, shared.
import { dataOwnerId as accountOwnerId } from '../auth/access.js';

// A refund arriving means the return was lodged and assessed, so the period is
// closed: editing what it contained afterwards would leave the records saying
// something different from what was actually claimed. The lock is enforced
// here rather than in each route so a handler written later can't quietly
// bypass it.
//
// A period is a whole year for books that lodge annually and a quarter for
// books that lodge quarterly, so everything here is per set of books.

async function cadenceFor(entityId) {
  if (!entityId) return 'annual';
  const [rows] = await pool.execute('SELECT lodgement_cadence FROM entities WHERE id = ?', [entityId]);
  return normaliseCadence(rows[0]?.lodgement_cadence);
}

export async function isPeriodFinalised(user, entityId, financialYear, period) {
  const ownerId = accountOwnerId(user);
  if (!ownerId || !financialYear) return false;
  const [rows] = await pool.execute(
    `SELECT finalised_at FROM tax_years
     WHERE user_id = ? AND entity_id = ? AND financial_year = ? AND period = ? AND finalised_at IS NOT NULL`,
    [ownerId, entityId, financialYear, period]
  );
  return rows.length > 0;
}

// Every closed lodgement for this account, so the client can grey out what it
// must not offer instead of finding out on submit.
export async function finalisedPeriodsFor(user, entityId = null) {
  const ownerId = accountOwnerId(user);
  if (!ownerId) return [];
  const [rows] = await pool.execute(
    `SELECT entity_id, financial_year, period FROM tax_years
     WHERE user_id = ? AND finalised_at IS NOT NULL${entityId ? ' AND entity_id = ?' : ''}`,
    entityId ? [ownerId, entityId] : [ownerId]
  );
  return rows.map((r) => ({ entityId: r.entity_id, financialYear: r.financial_year, period: r.period }));
}

// The years where every period is closed. Kept because the client greys out
// whole years in its pickers, and a year with one open quarter left in it is
// not a closed year.
export async function finalisedYearsFor(user, entityId = null) {
  const closed = await finalisedPeriodsFor(user, entityId);
  if (closed.length === 0) return [];

  const byEntity = new Map();
  for (const row of closed) {
    const key = `${row.entityId}|${row.financialYear}`;
    if (!byEntity.has(key)) byEntity.set(key, { ...row, periods: new Set() });
    byEntity.get(key).periods.add(row.period);
  }

  const years = new Set();
  for (const entry of byEntity.values()) {
    const cadence = await cadenceFor(entry.entityId);
    const expected = lodgementPeriodsFor(entry.financialYear, user.financialYearRule, cadence);
    if (expected.length > 0 && expected.every((p) => entry.periods.has(p.period))) {
      years.add(entry.financialYear);
    }
  }
  return [...years];
}

// Refuses a write that would land in — or move something out of — a closed
// lodgement. Every date is checked, because moving an expense across a boundary
// changes two periods at once and both have to be open.
//
// An options object, and it throws when entityId is missing, on purpose. There
// are a handful of call sites and JavaScript will not warn about one written
// next month. A positional argument would let a missed site pass a date as the
// entity and silently check the wrong books; a soft default would let it permit
// everything. Only a hard throw turns a mistake into something you find out
// about immediately.
export async function blockIfFinalised(user, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('blockIfFinalised(user, { entityId, dates }) — pass an options object');
  }
  const { entityId, dates } = options;
  if (entityId === undefined) throw new Error('blockIfFinalised: entityId is required');
  if (!Array.isArray(dates)) throw new Error('blockIfFinalised: dates must be an array');
  if (!entityId) return null;

  const cadence = await cadenceFor(entityId);
  const covered = periodsCovering(dates.filter(Boolean), user.financialYearRule, cadence);

  for (const { financialYear, period } of covered) {
    if (await isPeriodFinalised(user, entityId, financialYear, period)) {
      const [label] = lodgementPeriodsFor(financialYear, user.financialYearRule, cadence).filter(
        (p) => p.period === period
      );
      const what = period === 'FY' ? `FY ${financialYear}` : `${label?.label || period} (${financialYear})`;
      return `${what} has been finalised — reopen it from Reports before changing anything in it.`;
    }
  }
  return null;
}
