import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { dataOwnerId } from '../auth/access.js';
import { toTitleCase } from '../lib/text.js';
import { defaultFinancialYear } from '../lib/financialYear.js';
import { CADENCES, normaliseCadence } from '../lib/lodgementPeriods.js';
import { canAddEntity, entityAllowance } from '../lib/planLimits.js';
import {
  ENTITY_KINDS,
  normaliseKind,
  entityPathSegment,
  listEntities,
  entityFor,
  ensureDefaultEntity,
  setDefaultEntity,
  shapeEntity,
} from '../lib/entities.js';

const router = Router();
router.use(requireAuth);

const MAX_NAME = 60;

function readOnly(req, res) {
  if (req.user.readOnly) {
    res.status(403).json({ error: 'You are viewing this account as an administrator — it is read-only.' });
    return true;
  }
  if (req.user.actingAsClient) {
    res.status(403).json({ error: 'Only the account holder can change how their books are organised.' });
    return true;
  }
  return false;
}

function validateName(name) {
  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) return { error: 'Give it a name of at least two characters' };
  if (trimmed.length > MAX_NAME) return { error: `Keep the name under ${MAX_NAME} characters` };
  return { name: toTitleCase(trimmed) };
}

// What each set of books holds. Used to decide whether one can be deleted, and
// shown on the card so "delete" is never a surprise.
async function countsFor(ownerId, entityId) {
  const [[row]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM expenses WHERE entity_id = ? AND deleted_at IS NULL) AS expenses,
       (SELECT COUNT(*) FROM categories WHERE entity_id = ?) AS categories,
       (SELECT COUNT(*) FROM vehicle_trips WHERE entity_id = ?) AS trips,
       (SELECT COUNT(*) FROM home_office_hours WHERE entity_id = ?) AS hours,
       (SELECT COUNT(*) FROM tax_years WHERE entity_id = ? AND finalised_at IS NOT NULL) AS finalised,
       (SELECT COUNT(*) FROM expenses WHERE entity_id = ? AND deleted_at IS NULL AND business_use_pct < 100) AS apportioned`,
    [entityId, entityId, entityId, entityId, entityId, entityId]
  );
  return {
    expenses: Number(row.expenses),
    categories: Number(row.categories),
    trips: Number(row.trips),
    hours: Number(row.hours),
    finalised: Number(row.finalised),
    apportioned: Number(row.apportioned),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ownerId = dataOwnerId(req.user);
    // Defensive: an account created between two releases, or one the migration
    // could not see, still gets somewhere to file rather than an empty list.
    await ensureDefaultEntity(ownerId);

    // Only the books this session may actually read.
    //
    // listEntities returns everything the account holder has, and for an
    // accountant given one of three sets of books that was three in the
    // switcher. Choosing one of the other two did nothing useful — every read
    // behind it is scoped by allowedEntityIds and answers with the granted
    // books regardless — so the picker offered choices that were not choices,
    // and named two businesses the client had not shared.
    //
    // The grant is the same list the scope functions use, so the picker and the
    // pages behind it cannot disagree about what was shared.
    const visible = await listEntities(ownerId);
    const grant = req.user.allowedEntityIds;
    const rows =
      grant && grant.length > 0
        ? visible.filter((row) => grant.some((id) => String(id) === String(row.id)))
        : visible;

    const entities = [];
    for (const row of rows) {
      entities.push({ ...shapeEntity(row), counts: await countsFor(ownerId, row.id) });
    }
    // Sent so the page can say what the plan allows before somebody types a
    // name and is refused. Archived books count against it, so this reads the
    // full list rather than the visible one.
    // The allowance is the account holder's, counted across everything they
    // have — an accountant is not the person it constrains, and narrowing this
    // to their grant would tell them the client had fewer businesses than they
    // are paying for.
    const all = await listEntities(ownerId, { includeArchived: true });
    const usedBusinesses = all.filter((e) => e.kind === 'business').length;
    const allowedBusinesses = entityAllowance(req.user.planType).businesses;

    // Sent separately rather than mixed into `entities`, so every caller that
    // reads that list today — the picker, the expense form, the deductions
    // page, exports — keeps getting exactly what it gets now.
    //
    // Listed at all because they still count against the cap above. Without
    // them, archiving a business and then being refused another reads as the
    // app contradicting itself: "you have all 2" with one on the screen.
    // Archived books, narrowed the same way the visible ones are. An
    // accountant has no business reading the names of books that were never
    // shared with them, archived or not.
    const archived = all
      .filter((e) => e.archived_at)
      .filter((e) => !(grant && grant.length > 0) || grant.some((id) => String(id) === String(e.id)))
      .map((row) => shapeEntity(row));

    res.json({
      entities,
      archived,
      selected: req.user.entityId || null,
      allowance: {
        businesses: allowedBusinesses,
        businessesUsed: usedBusinesses,
        // Never negative — an account grandfathered above its cap has none
        // left, rather than a negative number to render.
        businessesLeft: Math.max(0, allowedBusinesses - usedBusinesses),
        planType: req.user.planType || 'individual',
      },
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (readOnly(req, res)) return;
    const ownerId = dataOwnerId(req.user);

    const { name, error } = validateName(req.body?.name);
    if (error) return res.status(400).json({ error });

    const kind = normaliseKind(req.body?.kind);
    // A business defaults to quarterly and an individual to annual, but both are
    // the entity's own choice — plenty of small businesses lodge once a year.
    const cadence = req.body?.cadence ? normaliseCadence(req.body.cadence) : kind === 'business' ? 'quarterly' : 'annual';

    const existing = await listEntities(ownerId, { includeArchived: true });
    if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: `You already have a set of books called ${name}` });
    }

    // What the plan pays for. Archived books count — unarchiving is one click,
    // and a cap you can step around by archiving is not a cap.
    //
    // Only creation is checked. An account that already holds more than its
    // plan allows keeps every one of them: deleting somebody's records because
    // a price changed would be the wrong answer to a pricing decision.
    const allowed = canAddEntity({
      planType: req.user.planType,
      kind,
      existing: existing.map((e) => ({ kind: normaliseKind(e.kind) })),
    });
    if (!allowed.ok) {
      return res.status(403).json({ error: allowed.message, reason: allowed.reason, needsPlan: allowed.needsPlan });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // The first set of books an account has is its default — the one opened
      // on sign-in and the one an expense is filed into when nothing else is
      // chosen. Every account needs one, and until now none was ever set on
      // create, so an account only had a default if somebody pressed the
      // button. `existing` is every set of books including archived ones, so
      // archiving the only one does not quietly hand the title to the next.
      const isFirst = existing.length === 0 ? 1 : 0;
      const [result] = await conn.execute(
        `INSERT INTO entities (user_id, name, kind, lodgement_cadence, is_default, path_segment)
         VALUES (?, ?, ?, ?, ?, NULL)`,
        [ownerId, name, kind, cadence, isFirst]
      );
      const id = result.insertId;

      // The folder segment needs the id to disambiguate, so it is written after
      // the insert — and never touched again, because a rename must not move a
      // single file on disk.
      const segment = entityPathSegment(
        name,
        id,
        existing.map((e) => e.path_segment)
      );
      await conn.execute('UPDATE entities SET path_segment = ? WHERE id = ?', [segment, id]);
      await conn.commit();

      // Seeded explicitly rather than left to ensureCategoriesForYear, which
      // would find no earlier year for these books and fall through to the
      // global defaults — quietly giving a plumbing business a Home Rental.
      const year = defaultFinancialYear(req.user.financialYearRule);
      await seedStarterCategories(ownerId, id, year, kind);

      const [rows] = await pool.execute('SELECT * FROM entities WHERE id = ?', [id]);
      res.status(201).json({ entity: { ...shapeEntity(rows[0]), counts: await countsFor(ownerId, id) } });
    } catch (err) {
      await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'You already have a set of books called that' });
      throw err;
    } finally {
      conn.release();
    }
  })
);

// A handful of categories to start with, rather than an empty page or the
// personal defaults. Deliberately short: people add their own, and a long list
// of guesses is worse than a few obvious ones.
const STARTER_CATEGORIES = {
  business: [
    ['General', '#8b5cf6', 'receipt'],
    ['Tools & Equipment', '#f59e0b', 'wrench'],
    ['Vehicle & Travel', '#3b82f6', 'car'],
    ['Software & Subscriptions', '#06b6d4', 'cpu'],
    ['Materials', '#10b981', 'box'],
  ],
  individual: [
    ['General', '#8b5cf6', 'receipt'],
    ['Work Related', '#3b82f6', 'briefcase'],
    ['Education', '#06b6d4', 'graduation-cap'],
    ['Other', '#a1a1aa', 'tag'],
  ],
};

async function seedStarterCategories(ownerId, entityId, financialYear, kind) {
  for (const [name, color, icon] of STARTER_CATEGORIES[kind] || STARTER_CATEGORIES.individual) {
    await pool
      .execute(
        `INSERT INTO categories (user_id, entity_id, name, color, icon, financial_year) VALUES (?, ?, ?, ?, ?, ?)`,
        [ownerId, entityId, name, color, icon, financialYear]
      )
      .catch(() => {});
  }
}

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (readOnly(req, res)) return;
    const ownerId = dataOwnerId(req.user);
    const entity = await entityFor(ownerId, Number(req.params.id));
    if (!entity) return res.status(404).json({ error: 'Not found' });

    const updates = [];
    const params = [];

    if (req.body?.name !== undefined) {
      const { name, error } = validateName(req.body.name);
      if (error) return res.status(400).json({ error });
      updates.push('name = ?');
      params.push(name);
      // path_segment is deliberately left alone. It was fixed at creation so
      // that renaming can never move a receipt — which is exactly the bug a
      // category rename still has to work around with a filesystem move.
    }

    if (req.body?.kind !== undefined) {
      const kind = normaliseKind(req.body.kind);
      if (!ENTITY_KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind' });

      // Turning a set of books into a business is creating one as far as the
      // plan is concerned. Without this, Individual — which allows no
      // businesses at all — was two clicks away from the entire business
      // feature set: open the only set of books there is, press Small business.
      // The same check keeps the one-individual rule from being walked around
      // in the other direction.
      //
      // Checked only when the kind actually changes, so saving a name on a
      // grandfathered account is never refused for a value it already had.
      if (kind !== normaliseKind(entity.kind)) {
        const siblings = (await listEntities(ownerId, { includeArchived: true }))
          .filter((e) => e.id !== entity.id)
          .map((e) => ({ kind: normaliseKind(e.kind) }));
        const allowed = canAddEntity({ planType: req.user.planType, kind, existing: siblings });
        if (!allowed.ok) {
          return res.status(403).json({ error: allowed.message, reason: allowed.reason, needsPlan: allowed.needsPlan });
        }
      }

      if (kind === 'individual' && entity.kind === 'business') {
        // The business-use field disappears for an individual, and hiding a
        // field that is still apportioning money would make the app lie about
        // what it is claiming.
        const counts = await countsFor(ownerId, entity.id);
        if (counts.apportioned > 0) {
          return res.status(409).json({
            error: `${counts.apportioned} expense${counts.apportioned === 1 ? ' is' : 's are'} claimed at less than 100% business use. Set ${counts.apportioned === 1 ? 'it' : 'them'} to 100% first, or leave this as a business.`,
          });
        }
      }
      updates.push('kind = ?');
      params.push(kind);
    }

    if (req.body?.cadence !== undefined) {
      const cadence = normaliseCadence(req.body.cadence);
      if (!CADENCES.includes(cadence)) return res.status(400).json({ error: 'Unknown cadence' });
      updates.push('lodgement_cadence = ?');
      params.push(cadence);
    }

    if (req.body?.color !== undefined) {
      updates.push('color = ?');
      params.push(String(req.body.color).slice(0, 20) || null);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      await pool.execute(`UPDATE entities SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, [
        ...params,
        entity.id,
        ownerId,
      ]);
    }

    if (req.body?.isDefault === true) {
      await setDefaultEntity(ownerId, entity.id);
    }

    const [rows] = await pool.execute('SELECT * FROM entities WHERE id = ?', [entity.id]);
    res.json({ entity: { ...shapeEntity(rows[0]), counts: await countsFor(ownerId, entity.id) } });
  })
);

// Archiving, which is what "I closed that business" actually means. The records
// stay — a closed year still has to be produceable years later.
router.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    if (readOnly(req, res)) return;
    const ownerId = dataOwnerId(req.user);
    const entity = await entityFor(ownerId, Number(req.params.id));
    if (!entity) return res.status(404).json({ error: 'Not found' });
    if (entity.is_default) {
      return res.status(409).json({ error: 'This is where new records go by default. Make another set of books the default first.' });
    }
    const archive = req.body?.archived !== false;
    await pool.execute('UPDATE entities SET archived_at = ?, updated_at = NOW() WHERE id = ?', [
      archive ? new Date() : null,
      entity.id,
    ]);
    res.json({ ok: true, archived: archive });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (readOnly(req, res)) return;
    const ownerId = dataOwnerId(req.user);
    const entity = await entityFor(ownerId, Number(req.params.id));
    if (!entity) return res.status(404).json({ error: 'Not found' });
    if (entity.is_default) return res.status(409).json({ error: 'The default set of books cannot be deleted' });

    // Refused with a count and a reason, the same way a category with expenses
    // in it is. The foreign keys would stop this anyway; being told why is the
    // difference between a refusal and an error.
    const counts = await countsFor(ownerId, entity.id);
    const holding = [
      counts.expenses && `${counts.expenses} expense${counts.expenses === 1 ? '' : 's'}`,
      counts.trips && `${counts.trips} vehicle trip${counts.trips === 1 ? '' : 's'}`,
      counts.hours && `${counts.hours} home office entr${counts.hours === 1 ? 'y' : 'ies'}`,
      counts.finalised && `${counts.finalised} finalised year${counts.finalised === 1 ? '' : 's'}`,
    ].filter(Boolean);

    if (holding.length > 0) {
      return res.status(409).json({
        error: `${entity.name} still holds ${holding.join(', ')}. Archive it instead — the records stay, and it disappears from the switcher.`,
      });
    }

    // Only the starter categories can remain, and they go with it.
    await pool.execute('DELETE FROM categories WHERE entity_id = ? AND user_id = ?', [entity.id, ownerId]);
    await pool.execute('DELETE FROM tax_years WHERE entity_id = ? AND user_id = ?', [entity.id, ownerId]);
    await pool.execute('DELETE FROM entities WHERE id = ? AND user_id = ?', [entity.id, ownerId]);
    res.json({ ok: true });
  })
);

export default router;
