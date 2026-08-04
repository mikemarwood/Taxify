import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { financialYearRange } from '../lib/financialYear.js';
import { lodgementPeriodsFor, normaliseCadence, isPeriod } from '../lib/lodgementPeriods.js';
import { listEntities, ensureDefaultEntity, shapeEntity } from '../lib/entities.js';

const router = Router();
router.use(requireAuth);

const FY = 'FY';
const MAX_REFUND = 9999999.99;

// A year's admin belongs to the account, not to whichever login recorded it —
// a family member and their accountant are looking at the same return.
import { dataOwnerId as accountOwnerId } from '../auth/access.js';

// Accountants are read-only everywhere except here. The exception is deliberate
// and narrow: the refund figure and the appointment are the two things they are
// more likely to know than their client. It still holds them to the years they
// were given.
function canWrite(user, financialYear) {
  if (!accountOwnerId(user)) return 'You need an account before this can be recorded.';
  if (user.readOnly) return 'You are viewing this account as an administrator — it is read-only.';

  if (user.actingAsClient) {
    const years = user.allowedFinancialYears;
    if (financialYear && years && !years.includes(financialYear)) {
      return `You were given ${years.join(', ')} on this account — ${financialYear} is not yours to record.`;
    }
    return null;
  }

  if (user.accessLocked) return 'subscription_required';
  return null;
}

const COLUMNS = `t.entity_id, t.financial_year, t.period, t.amount, t.notes, t.recorded_at, t.updated_at, t.finalised_at,
                 t.appointment_at, t.appointment_company, t.appointment_accountant,
                 u.name AS recorded_by_name`;

function shape(row) {
  return {
    entityId: row.entity_id,
    financialYear: row.financial_year,
    period: row.period || FY,
    amount: row.amount === null ? null : Number(row.amount),
    notes: row.notes || '',
    recordedBy: row.recorded_by_name || null,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
    finalisedAt: row.finalised_at || null,
    appointment: row.appointment_at
      ? {
          at: row.appointment_at,
          company: row.appointment_company || '',
          accountant: row.appointment_accountant || '',
        }
      : null,
  };
}

async function readYear(ownerId, entityId, financialYear, period) {
  const [rows] = await pool.execute(
    `SELECT ${COLUMNS} FROM tax_years t LEFT JOIN users u ON u.id = t.recorded_by
     WHERE t.user_id = ? AND t.entity_id = ? AND t.financial_year = ? AND t.period = ?`,
    [ownerId, entityId, financialYear, period]
  );
  return rows[0] ? shape(rows[0]) : null;
}

// Creates the row if it isn't there, so callers can just update their own
// columns without each one repeating the insert.
async function ensureRow(ownerId, entityId, financialYear, period) {
  await pool.execute(
    'INSERT IGNORE INTO tax_years (user_id, entity_id, financial_year, period) VALUES (?, ?, ?, ?)',
    [ownerId, entityId, financialYear, period]
  );
}

// Which lodgement a write is about. The period is optional so a client that has
// never heard of quarters still lands on the annual row, and it is refused
// rather than tidied because it becomes part of a database key.
function requestedPeriod(req) {
  const asked = req.body?.period || req.query?.period;
  if (!asked) return FY;
  return isPeriod(asked) ? asked : null;
}

// The books a tax-year write is about: the selected ones, or the account's
// default when nothing is selected. Unlike an expense this can fall back — a
// refund has to be recordable from any view.
async function booksFor(req) {
  const ownerId = accountOwnerId(req.user);
  if (req.user.entityId) return req.user.entityId;
  const fallback = await ensureDefaultEntity(ownerId);
  return fallback?.id || null;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ownerId = accountOwnerId(req.user);
    if (!ownerId) return res.json({ years: [] });

    await ensureDefaultEntity(ownerId);

    const [rows] = await pool.execute(
      `SELECT ${COLUMNS} FROM tax_years t LEFT JOIN users u ON u.id = t.recorded_by
       WHERE t.user_id = ? ORDER BY t.financial_year DESC`,
      [ownerId]
    );

    // An accountant given only part of the history sees only that part — a
    // refund says as much about a year as its expenses do.
    const allowed = req.user.actingAsClient ? req.user.allowedFinancialYears : null;
    const visible = allowed ? rows.filter((r) => allowed.includes(r.financial_year)) : rows;

    // Grouped by set of books, each year expanded into the lodgements those
    // books actually file. Books that lodge annually get one row per year and
    // look exactly as they always did; quarterly books get four.
    const books = (await listEntities(ownerId)).filter((e) => !req.user.entityId || e.id === req.user.entityId);
    const rule = req.user.financialYearRule;

    const entities = books.map((entity) => {
      const cadence = normaliseCadence(entity.lodgement_cadence);
      const mine = visible.filter((r) => r.entity_id === entity.id);
      const yearLabels = [...new Set(mine.map((r) => r.financial_year))].sort().reverse();

      return {
        ...shapeEntity(entity),
        years: yearLabels.map((financialYear) => ({
          financialYear,
          periods: lodgementPeriodsFor(financialYear, rule, cadence).map((period) => {
            const row = mine.find((r) => r.financial_year === financialYear && (r.period || FY) === period.period);
            return { ...period, ...(row ? shape(row) : { entityId: entity.id, financialYear, period: period.period }) };
          }),
        })),
      };
    });

    res.json({
      canEdit: canWrite(req.user, null) === null,
      canReopen: !req.user.actingAsClient && !req.user.readOnly,
      entities,
      // Kept alongside so nothing that reads the flat list breaks mid-release.
      years: visible.map(shape),
    });
  })
);

// Recording the refund closes the year. The client asks before sending;
// opting out is possible but is not the default.
router.put(
  '/:financialYear/refund',
  asyncHandler(async (req, res) => {
    const { financialYear } = req.params;
    if (!financialYearRange(financialYear, req.user.financialYearRule)) {
      return res.status(400).json({ error: 'Expected a financial year like 2025-2026' });
    }

    const refusal = canWrite(req.user, financialYear);
    if (refusal === 'subscription_required') return res.status(403).json({ error: 'subscription_required' });
    if (refusal) return res.status(403).json({ error: refusal });

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Enter the refund as a positive amount' });
    }
    if (amount > MAX_REFUND) return res.status(400).json({ error: 'That amount is too large' });

    const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null;
    const finalise = req.body?.finalise !== false;
    const ownerId = accountOwnerId(req.user);

    const period = requestedPeriod(req);
    if (!period) return res.status(400).json({ error: 'Unknown lodgement period' });
    const entityId = await booksFor(req);
    if (!entityId) return res.status(400).json({ error: 'Choose which business this is for' });

    await ensureRow(ownerId, entityId, financialYear, period);
    await pool.execute(
      `UPDATE tax_years
       SET amount = ?, notes = ?, recorded_by = ?,
           recorded_at = COALESCE(recorded_at, NOW()), updated_at = NOW()
           ${finalise ? ', finalised_at = COALESCE(finalised_at, NOW()), finalised_by = ?' : ''}
       WHERE user_id = ? AND entity_id = ? AND financial_year = ? AND period = ?`,
      finalise
        ? [amount.toFixed(2), notes, req.user.id, req.user.id, ownerId, entityId, financialYear, period]
        : [amount.toFixed(2), notes, req.user.id, ownerId, entityId, financialYear, period]
    );

    res.json({ year: await readYear(ownerId, entityId, financialYear, period) });
  })
);

// When the return is being done and with whom. Only offered while the year is
// still open — an appointment for a year that's already been assessed is a
// note about the past, not something to count down to.
router.put(
  '/:financialYear/appointment',
  asyncHandler(async (req, res) => {
    const { financialYear } = req.params;
    if (!financialYearRange(financialYear, req.user.financialYearRule)) {
      return res.status(400).json({ error: 'Expected a financial year like 2025-2026' });
    }

    const refusal = canWrite(req.user, financialYear);
    if (refusal === 'subscription_required') return res.status(403).json({ error: 'subscription_required' });
    if (refusal) return res.status(403).json({ error: refusal });

    const { date, time, company, accountant } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'Enter the appointment date' });
    }
    if (!/^\d{2}:\d{2}$/.test(String(time || ''))) {
      return res.status(400).json({ error: 'Enter the appointment time' });
    }
    if (!company || !String(company).trim()) {
      return res.status(400).json({ error: 'Enter who you are seeing' });
    }

    // Stored as a plain local datetime string — the appointment is at the time
    // written on it wherever the person happens to be reading from.
    const appointmentAt = `${date} ${time}:00`;
    const ownerId = accountOwnerId(req.user);

    const period = requestedPeriod(req);
    if (!period) return res.status(400).json({ error: 'Unknown lodgement period' });
    const entityId = await booksFor(req);
    if (!entityId) return res.status(400).json({ error: 'Choose which business this is for' });

    await ensureRow(ownerId, entityId, financialYear, period);
    await pool.execute(
      `UPDATE tax_years
       SET appointment_at = ?, appointment_company = ?, appointment_accountant = ?,
           appointment_reminder_sent_at = NULL
       WHERE user_id = ? AND entity_id = ? AND financial_year = ? AND period = ?`,
      [
        appointmentAt,
        String(company).trim().slice(0, 160),
        accountant ? String(accountant).trim().slice(0, 160) : null,
        ownerId,
        entityId,
        financialYear,
        period,
      ]
    );

    res.json({ year: await readYear(ownerId, entityId, financialYear, period) });
  })
);

router.delete(
  '/:financialYear/appointment',
  asyncHandler(async (req, res) => {
    const refusal = canWrite(req.user, req.params.financialYear);
    if (refusal === 'subscription_required') return res.status(403).json({ error: 'subscription_required' });
    if (refusal) return res.status(403).json({ error: refusal });

    const ownerId = accountOwnerId(req.user);
    const period = requestedPeriod(req);
    if (!period) return res.status(400).json({ error: 'Unknown lodgement period' });
    const entityId = await booksFor(req);
    await pool.execute(
      `UPDATE tax_years SET appointment_at = NULL, appointment_company = NULL,
       appointment_accountant = NULL, appointment_reminder_sent_at = NULL
       WHERE user_id = ? AND entity_id = ? AND financial_year = ? AND period = ?`,
      [ownerId, entityId, req.params.financialYear, period]
    );
    res.json({ year: await readYear(ownerId, entityId, req.params.financialYear, period) });
  })
);

// Reopening is the account holder's call, never the accountant's — an
// accountant closing a year must not leave their client unable to correct it
// after their access has expired.
router.post(
  '/:financialYear/reopen',
  asyncHandler(async (req, res) => {
    if (req.user.actingAsClient) {
      return res.status(403).json({ error: 'Only the account holder can reopen a finalised year.' });
    }
    const refusal = canWrite(req.user, req.params.financialYear);
    if (refusal === 'subscription_required') return res.status(403).json({ error: 'subscription_required' });
    if (refusal) return res.status(403).json({ error: refusal });

    const ownerId = accountOwnerId(req.user);
    const period = requestedPeriod(req);
    if (!period) return res.status(400).json({ error: 'Unknown lodgement period' });
    const entityId = await booksFor(req);
    await pool.execute(
      `UPDATE tax_years SET finalised_at = NULL, finalised_by = NULL
       WHERE user_id = ? AND entity_id = ? AND financial_year = ? AND period = ?`,
      [ownerId, entityId, req.params.financialYear, period]
    );
    res.json({ year: await readYear(ownerId, entityId, req.params.financialYear, period) });
  })
);

export default router;
