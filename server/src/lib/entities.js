import pool from '../db.js';
import { categoryToFolderSegment, INBOX_SEGMENT } from './receiptStorage.js';
// The permissive label test, not receiptStorage's stricter one. A calendar-year
// account really does have folders called "2025", so both shapes have to be
// treated as years here or an entity could be named after one.
import { isFinancialYearLabel } from './financialYear.js';
import { normaliseCadence } from './lodgementPeriods.js';

// Sets of books.
//
// One Individual per account, plus any number of small businesses. The kind is
// what decides whether an expense is asked for a business-use percentage, and
// the cadence is what decides how often the books are lodged.

export const ENTITY_KINDS = ['individual', 'business'];

export function normaliseKind(value) {
  return ENTITY_KINDS.includes(String(value || '')) ? String(value) : 'individual';
}

// The folder a non-default entity's receipts live under.
//
// Two things make this fussier than a category segment. It sits beside the
// financial-year folders, and categories.routes reads every child of receipts/
// that is not _inbox as a year — so a business called "2025-2026" would be
// scanned as one, and a category delete would rmSync it. And it is stored
// rather than derived, so it survives a rename: renaming a business must never
// move a file, which is the one thing category renames still get wrong.
export function entityPathSegment(name, id, taken = []) {
  const base = categoryToFolderSegment(name);
  const used = new Set(taken.filter(Boolean));

  // Anything that could be mistaken for a year folder, or for the inbox, gets
  // the id appended — as does a name already in use.
  const clashes = (candidate) =>
    !candidate || isFinancialYearLabel(candidate) || candidate === INBOX_SEGMENT || used.has(candidate);

  if (!clashes(base)) return base;

  const suffixed = `${base || 'entity'}-e${id}`;
  // The id is unique per account, so this can only clash with itself.
  return suffixed;
}

// Where a write lands. "Everything" is a way of looking at the books, not a
// place to file something into, so it is refused here rather than guessed at by
// each route in turn.
export function writeEntityId(user) {
  if (!user?.entityId) {
    throw Object.assign(new Error('Choose which business this belongs to'), { status: 400 });
  }
  return user.entityId;
}

// The same question when a form names the books itself rather than relying on
// what is selected. The id has to be checked against the account that owns it:
// unvalidated, a number from a request body files a row into a set of books
// that is not yours, where it is invisible to you *and* to whoever owns that
// id — which reads as losing the record, not as being refused.
export async function resolveWriteEntity(user, ownerId, requested) {
  const asked = Number(requested) || null;
  if (!asked) return writeEntityId(user);
  const owned = await entityFor(ownerId, asked);
  if (!owned) {
    throw Object.assign(new Error('That set of books is not on this account'), { status: 400 });
  }
  if (owned.archived_at) {
    throw Object.assign(new Error(`${owned.name} is archived — restore it before adding to it`), { status: 409 });
  }
  return owned.id;
}

export function shapeEntity(row) {
  return {
    id: row.id,
    name: row.name,
    kind: normaliseKind(row.kind),
    cadence: normaliseCadence(row.lodgement_cadence),
    isDefault: !!row.is_default,
    color: row.color || null,
    archivedAt: row.archived_at || null,
    createdAt: row.created_at,
  };
}

export async function listEntities(ownerId, { includeArchived = false } = {}) {
  const [rows] = await pool.execute(
    `SELECT * FROM entities WHERE user_id = ?${includeArchived ? '' : ' AND archived_at IS NULL'}
     ORDER BY is_default DESC, name`,
    [ownerId]
  );
  return rows;
}

export async function entityFor(ownerId, entityId) {
  const [rows] = await pool.execute('SELECT * FROM entities WHERE id = ? AND user_id = ?', [entityId, ownerId]);
  return rows[0] || null;
}

export async function defaultEntityFor(ownerId) {
  const [rows] = await pool.execute(
    'SELECT * FROM entities WHERE user_id = ? AND is_default = 1 ORDER BY id LIMIT 1',
    [ownerId]
  );
  return rows[0] || null;
}

// Nobody may be without one. Called at registration and defensively whenever
// the list is read, so an account created between two releases — or one the
// migration could not see — still has somewhere to file.
export async function ensureDefaultEntity(ownerId) {
  const existing = await defaultEntityFor(ownerId);
  if (existing) return existing;

  // An account may already have entities but no default — possible only if a
  // default were archived, which is refused, but cheap to recover from.
  const [any] = await pool.execute('SELECT * FROM entities WHERE user_id = ? ORDER BY id LIMIT 1', [ownerId]);
  if (any[0]) {
    await pool.execute('UPDATE entities SET is_default = 1 WHERE id = ?', [any[0].id]);
    return { ...any[0], is_default: 1 };
  }

  try {
    await pool.execute(
      `INSERT INTO entities (user_id, name, kind, lodgement_cadence, is_default, path_segment)
       VALUES (?, 'Individual', 'individual', 'annual', 1, NULL)`,
      [ownerId]
    );
  } catch (err) {
    // Two requests arriving together both find nothing and both insert. The
    // unique key settles it; the loser just reads what the winner wrote.
    if (err.code !== 'ER_DUP_ENTRY') throw err;
  }
  return defaultEntityFor(ownerId);
}

// Exactly one default per account. MariaDB has no partial unique index, so the
// invariant lives in this one function rather than in the schema — which means
// nothing else may write is_default.
export async function setDefaultEntity(ownerId, entityId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE entities SET is_default = 0 WHERE user_id = ?', [ownerId]);
    const [result] = await conn.execute(
      'UPDATE entities SET is_default = 1, updated_at = NOW() WHERE id = ? AND user_id = ? AND archived_at IS NULL',
      [entityId, ownerId]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return false;
    }
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
