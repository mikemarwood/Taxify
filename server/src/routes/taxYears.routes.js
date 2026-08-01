import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { financialYearRange } from '../lib/financialYear.js';

const router = Router();
router.use(requireAuth);

const MAX_REFUND = 9999999.99;

// A year's admin belongs to the account, not to whichever login recorded it —
// a family member and their accountant are looking at the same return.
function accountOwnerId(user) {
  return user.role === 'owner' ? user.id : user.accountHolderId;
}

// Accountants are read-only everywhere except here. The exception is deliberate
// and narrow: the refund figure and the appointment are the two things they are
// more likely to know than their client. It still holds them to the years they
// were given.
function canWrite(user, financialYear) {
  if (!accountOwnerId(user)) return 'You need an account before this can be recorded.';
  if (user.readOnly) return 'You are viewing this account as an administrator — it is read-only.';

  if (user.role === 'accountant') {
    if (!user.activeClient) return 'Open a client first.';
    const years = user.allowedFinancialYears;
    if (financialYear && years && !years.includes(financialYear)) {
      return `You were given ${years.join(', ')} on this account — ${financialYear} is not yours to record.`;
    }
    return null;
  }

  if (user.accessLocked) return 'subscription_required';
  return null;
}

const COLUMNS = `t.financial_year, t.amount, t.notes, t.recorded_at, t.updated_at, t.finalised_at,
                 t.appointment_at, t.appointment_company, t.appointment_accountant,
                 u.name AS recorded_by_name`;

function shape(row) {
  return {
    financialYear: row.financial_year,
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

async function readYear(ownerId, financialYear) {
  const [rows] = await pool.execute(
    `SELECT ${COLUMNS} FROM tax_years t LEFT JOIN users u ON u.id = t.recorded_by
     WHERE t.user_id = ? AND t.financial_year = ?`,
    [ownerId, financialYear]
  );
  return rows[0] ? shape(rows[0]) : null;
}

// Creates the row if it isn't there, so callers can just update their own
// columns without each one repeating the insert.
async function ensureRow(ownerId, financialYear) {
  await pool.execute('INSERT IGNORE INTO tax_years (user_id, financial_year) VALUES (?, ?)', [
    ownerId,
    financialYear,
  ]);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ownerId = accountOwnerId(req.user);
    if (!ownerId) return res.json({ years: [] });

    const [rows] = await pool.execute(
      `SELECT ${COLUMNS} FROM tax_years t LEFT JOIN users u ON u.id = t.recorded_by
       WHERE t.user_id = ? ORDER BY t.financial_year DESC`,
      [ownerId]
    );

    // An accountant given only part of the history sees only that part — a
    // refund says as much about a year as its expenses do.
    const allowed = req.user.role === 'accountant' ? req.user.allowedFinancialYears : null;
    const visible = allowed ? rows.filter((r) => allowed.includes(r.financial_year)) : rows;

    res.json({
      canEdit: canWrite(req.user, null) === null,
      canReopen: req.user.role !== 'accountant' && !req.user.readOnly,
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
    if (!financialYearRange(financialYear)) {
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

    await ensureRow(ownerId, financialYear);
    await pool.execute(
      `UPDATE tax_years
       SET amount = ?, notes = ?, recorded_by = ?,
           recorded_at = COALESCE(recorded_at, NOW()), updated_at = NOW()
           ${finalise ? ', finalised_at = COALESCE(finalised_at, NOW()), finalised_by = ?' : ''}
       WHERE user_id = ? AND financial_year = ?`,
      finalise
        ? [amount.toFixed(2), notes, req.user.id, req.user.id, ownerId, financialYear]
        : [amount.toFixed(2), notes, req.user.id, ownerId, financialYear]
    );

    res.json({ year: await readYear(ownerId, financialYear) });
  })
);

// When the return is being done and with whom. Only offered while the year is
// still open — an appointment for a year that's already been assessed is a
// note about the past, not something to count down to.
router.put(
  '/:financialYear/appointment',
  asyncHandler(async (req, res) => {
    const { financialYear } = req.params;
    if (!financialYearRange(financialYear)) {
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

    await ensureRow(ownerId, financialYear);
    await pool.execute(
      `UPDATE tax_years
       SET appointment_at = ?, appointment_company = ?, appointment_accountant = ?,
           appointment_reminder_sent_at = NULL
       WHERE user_id = ? AND financial_year = ?`,
      [
        appointmentAt,
        String(company).trim().slice(0, 160),
        accountant ? String(accountant).trim().slice(0, 160) : null,
        ownerId,
        financialYear,
      ]
    );

    res.json({ year: await readYear(ownerId, financialYear) });
  })
);

router.delete(
  '/:financialYear/appointment',
  asyncHandler(async (req, res) => {
    const refusal = canWrite(req.user, req.params.financialYear);
    if (refusal === 'subscription_required') return res.status(403).json({ error: 'subscription_required' });
    if (refusal) return res.status(403).json({ error: refusal });

    const ownerId = accountOwnerId(req.user);
    await pool.execute(
      `UPDATE tax_years SET appointment_at = NULL, appointment_company = NULL,
       appointment_accountant = NULL, appointment_reminder_sent_at = NULL
       WHERE user_id = ? AND financial_year = ?`,
      [ownerId, req.params.financialYear]
    );
    res.json({ year: await readYear(ownerId, req.params.financialYear) });
  })
);

// Reopening is the account holder's call, never the accountant's — an
// accountant closing a year must not leave their client unable to correct it
// after their access has expired.
router.post(
  '/:financialYear/reopen',
  asyncHandler(async (req, res) => {
    if (req.user.role === 'accountant') {
      return res.status(403).json({ error: 'Only the account holder can reopen a finalised year.' });
    }
    const refusal = canWrite(req.user, req.params.financialYear);
    if (refusal === 'subscription_required') return res.status(403).json({ error: 'subscription_required' });
    if (refusal) return res.status(403).json({ error: refusal });

    const ownerId = accountOwnerId(req.user);
    await pool.execute(
      'UPDATE tax_years SET finalised_at = NULL, finalised_by = NULL WHERE user_id = ? AND financial_year = ?',
      [ownerId, req.params.financialYear]
    );
    res.json({ year: await readYear(ownerId, req.params.financialYear) });
  })
);

export default router;
