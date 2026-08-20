import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireActiveAccess } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { dataOwnerId } from '../auth/access.js';
import { financialYearOf, isFinancialYearLabel } from '../lib/financialYear.js';
// Tidied on the way in rather than on the way out, because the claim is
// grouped by vehicle name — 'hilux' and 'Hilux' would otherwise be two
// vehicles sharing one cap between them, and each would look under it.
import { titleCase, sentenceCase } from '../lib/text.js';
import { blockIfFinalised } from '../lib/finalisedYears.js';
import { entityFor, resolveWriteEntity } from '../lib/entities.js';
import { ratesFor, vehicleClaim, homeOfficeClaim, RATE_KEYS } from '../lib/deductions.js';

const router = Router();
router.use(requireAuth, requireActiveAccess);

// A logbook records what happened, so neither entry may be dated ahead.
//
// The pickers already stop this, and stopping it there is the useful half —
// but the picker is a suggestion to anything that is not a browser, and a
// claim dated next March is the sort of thing an audit asks about.
//
// A day of slack, because this server keeps UTC and an account in Auckland is
// most of a day ahead of it. Refusing somebody their own today to be strict
// about a date nobody can reach anyway is the worse trade.
function isFutureDate(date) {
  const limit = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return String(date) > limit;
}

// The two deductions that are not expenses: kilometres driven for work and
// hours worked from home. Both are logged as they happen, because both are
// claimed at a rate that only works if the record is contemporaneous.

function ownerOf(req) {
  return dataOwnerId(req.user);
}

// Everything for one year, with what it is worth. Kept in one response because
// the summary is the point — three separate calls to assemble one table is
// three chances for it to disagree with itself.
router.get(
  '/:financialYear',
  asyncHandler(async (req, res) => {
    const { financialYear } = req.params;
    if (!isFinancialYearLabel(financialYear)) return res.status(400).json({ error: 'Invalid financial year' });

    const userId = ownerOf(req);
    // Narrowed to the selected books when there are some, and every set of
    // books when there are not — the same rule reads use everywhere else.
    // The page can name a different set of books than the sidebar has
    // selected, and the list has to follow the same choice or it would show
    // one set of entries while adding to another. Validated, not trusted.
    let entityId = req.user.entityId || null;
    if (req.query.entityId) {
      const owned = await entityFor(userId, Number(req.query.entityId));
      if (!owned) return res.status(400).json({ error: 'That set of books is not on this account' });
      entityId = owned.id;
    }
    const scope = entityId ? ' AND entity_id = ?' : '';
    const params = entityId ? [userId, financialYear, entityId] : [userId, financialYear];

    const [trips] = await pool.execute(
      `SELECT id, trip_date, vehicle, km, purpose, odo_start, odo_end FROM vehicle_trips
       WHERE user_id = ? AND financial_year = ?${scope} ORDER BY trip_date DESC, id DESC`,
      params
    );
    const [hours] = await pool.execute(
      `SELECT id, entry_date, hours, note FROM home_office_hours
       WHERE user_id = ? AND financial_year = ?${scope} ORDER BY entry_date DESC, id DESC`,
      params
    );

    const rates = await ratesFor(financialYear);
    const vehicle = vehicleClaim(trips.map((t) => ({ vehicle: t.vehicle, km: Number(t.km) })), {
      centsPerKm: rates[RATE_KEYS.vehicleCentsPerKm] ?? null,
      kmCap: rates[RATE_KEYS.vehicleKmCap] ?? null,
    });
    const homeOffice = homeOfficeClaim(hours.map((h) => ({ hours: Number(h.hours) })), {
      perHour: rates[RATE_KEYS.homeOfficePerHour] ?? null,
    });

    res.json({
      financialYear,
      // Said explicitly so the client can explain a null claim as "no rate has
      // been set for this year" rather than showing a confident zero.
      rates: {
        centsPerKm: rates[RATE_KEYS.vehicleCentsPerKm] ?? null,
        kmCap: rates[RATE_KEYS.vehicleKmCap] ?? null,
        perHour: rates[RATE_KEYS.homeOfficePerHour] ?? null,
      },
      vehicle: {
        ...vehicle,
        trips: trips.map((t) => ({
          id: t.id,
          date: t.trip_date,
          vehicle: t.vehicle,
          km: Number(t.km),
          purpose: t.purpose || '',
          // Null for anything logged before the readings were kept, which the
          // page shows as a distance on its own rather than as a gap.
          odoStart: t.odo_start === null ? null : Number(t.odo_start),
          odoEnd: t.odo_end === null ? null : Number(t.odo_end),
        })),
      },
      homeOffice: {
        ...homeOffice,
        entries: hours.map((h) => ({
          id: h.id,
          date: h.entry_date,
          hours: Number(h.hours),
          note: h.note || '',
        })),
      },
    });
  })
);

// Writes are refused inside a client's books and inside a finalised year, the
// same as expenses — a deduction added after a return was assessed changes what
// was claimed.
async function assertWritable(req, res, date, entityId) {
  if (req.user.actingAsClient) {
    res.status(403).json({ error: 'Accountant access is read-only' });
    return false;
  }
  const closed = await blockIfFinalised(req.user, { entityId, dates: [date] });
  if (closed) {
    res.status(409).json({ error: closed });
    return false;
  }
  return true;
}

router.post(
  '/vehicle-trips',
  asyncHandler(async (req, res) => {
    const { date, vehicle, km, purpose } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ error: 'Enter the trip date' });
    if (isFutureDate(date)) return res.status(400).json({ error: 'A trip cannot be dated in the future' });
    if (!vehicle || !String(vehicle).trim()) return res.status(400).json({ error: 'Name the vehicle' });

    const distance = Number(km);
    if (!Number.isFinite(distance) || distance <= 0) return res.status(400).json({ error: 'Enter the kilometres driven' });
    if (distance > 100000) return res.status(400).json({ error: 'That distance is too large' });

    // The readings, where they were given.
    //
    // Optional on the wire: trips entered before these existed have none, and a
    // future caller might only know the distance. Kept only when they are a
    // pair that agrees with the distance being claimed — a start and an end
    // that do not subtract to the number on the claim are two different
    // stories, and storing both would leave nobody able to say which is true.
    const start = Number(req.body?.odoStart);
    const end = Number(req.body?.odoEnd);
    const readings =
      Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end - start === distance
        ? { start, end }
        : null;

    // The page names the books rather than relying on what is selected, so a
    // trip can be logged from the combined view without guessing.
    const entityId = await resolveWriteEntity(req.user, ownerOf(req), req.body?.entityId);
    if (!(await assertWritable(req, res, date, entityId))) return;

    const [result] = await pool.execute(
      `INSERT INTO vehicle_trips (user_id, entity_id, financial_year, trip_date, vehicle, km, purpose, created_by, odo_start, odo_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerOf(req),
        entityId,
        financialYearOf(date, req.user.financialYearRule),
        date,
        titleCase(vehicle).slice(0, 80),
        distance,
        purpose ? sentenceCase(purpose).slice(0, 255) || null : null,
        req.user.id,
        readings ? readings.start : null,
        readings ? readings.end : null,
      ]
    );
    res.status(201).json({ id: result.insertId });
  })
);

router.delete(
  '/vehicle-trips/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT trip_date, entity_id FROM vehicle_trips WHERE id = ? AND user_id = ?', [
      req.params.id,
      ownerOf(req),
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });
    if (!(await assertWritable(req, res, rows[0].trip_date, rows[0].entity_id))) return;

    await pool.execute('DELETE FROM vehicle_trips WHERE id = ? AND user_id = ?', [req.params.id, ownerOf(req)]);
    res.json({ ok: true });
  })
);

router.post(
  '/home-office',
  asyncHandler(async (req, res) => {
    const { date, hours, note } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ error: 'Enter the date' });
    if (isFutureDate(date)) return res.status(400).json({ error: 'Hours cannot be dated in the future' });

    const worked = Number(hours);
    if (!Number.isFinite(worked) || worked <= 0) return res.status(400).json({ error: 'Enter the hours worked' });
    // More than a day's worth in a day is a typo, not a claim.
    if (worked > 24) return res.status(400).json({ error: 'That is more than 24 hours' });

    const entityId = await resolveWriteEntity(req.user, ownerOf(req), req.body?.entityId);
    if (!(await assertWritable(req, res, date, entityId))) return;

    const [result] = await pool.execute(
      `INSERT INTO home_office_hours (user_id, entity_id, financial_year, entry_date, hours, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerOf(req),
        entityId,
        financialYearOf(date, req.user.financialYearRule),
        date,
        worked,
        note ? sentenceCase(note).slice(0, 255) || null : null,
        req.user.id,
      ]
    );
    res.status(201).json({ id: result.insertId });
  })
);

router.delete(
  '/home-office/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT entry_date, entity_id FROM home_office_hours WHERE id = ? AND user_id = ?', [
      req.params.id,
      ownerOf(req),
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found' });
    if (!(await assertWritable(req, res, rows[0].entry_date, rows[0].entity_id))) return;

    await pool.execute('DELETE FROM home_office_hours WHERE id = ? AND user_id = ?', [req.params.id, ownerOf(req)]);
    res.json({ ok: true });
  })
);

export default router;
