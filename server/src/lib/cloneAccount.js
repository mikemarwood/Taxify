import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import { userRootDir, RECEIPTS_SEGMENT } from './receiptStorage.js';

// Copying one account's records into another, receipts and all.
//
// A support tool, and a deliberately blunt one. It exists so a real set of
// books can be duplicated into a second account — for training, for a handover,
// for testing something against real shapes of data without touching the
// original.
//
// Three rules make it safe enough to hand to somebody:
//
//   The target must be empty. Not "probably empty" — refused outright if it has
//   a single expense. A copy landing on top of somebody's real records is not
//   something that can be undone, and there is no version of this tool worth
//   that risk.
//
//   The source is only ever read. Nothing about it is updated, moved or
//   deleted, so a failure halfway through cannot damage the account being
//   copied from.
//
//   Files are copied, never linked or moved. The two accounts must be genuinely
//   independent afterwards — deleting one has to leave the other whole, and a
//   shared file on disk would make that untrue in the worst possible way.

// Everything keyed to a user that is theirs rather than shared. Deliberately
// not: login_events, notifications, device_tokens, support tickets, invites,
// assignments or anything billing. Those describe a *person* — their sign-ins,
// their conversations with us, what they pay — and copying them into somebody
// else's account would be wrong in a way that is hard to undo.
const RECORD_TABLES = ['tax_years', 'vehicle_trips', 'home_office_hours'];

export async function accountSummary(userId) {
  const counts = {};
  for (const [key, sql] of [
    ['books', 'SELECT COUNT(*) AS n FROM entities WHERE user_id = ?'],
    ['categories', 'SELECT COUNT(*) AS n FROM categories WHERE user_id = ?'],
    ['expenses', 'SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND deleted_at IS NULL'],
    ['receipts', 'SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND receipt_path IS NOT NULL'],
    ['documents', 'SELECT COUNT(*) AS n FROM category_documents WHERE user_id = ?'],
    ['taxYears', 'SELECT COUNT(*) AS n FROM tax_years WHERE user_id = ?'],
  ]) {
    const [rows] = await pool.execute(sql, [userId]);
    counts[key] = Number(rows[0]?.n) || 0;
  }
  return counts;
}

// Whether this account can be copied into. Returned as a reason rather than a
// boolean so the admin panel can say which of the three things is wrong.
export async function targetProblem(userId) {
  const [users] = await pool.execute('SELECT id, email FROM users WHERE id = ?', [userId]);
  if (!users[0]) return 'That account does not exist';

  const summary = await accountSummary(userId);
  if (summary.expenses > 0) {
    return `That account already has ${summary.expenses} expenses. Copying into it would put two sets of records on top of each other.`;
  }
  if (summary.documents > 0) return 'That account already has documents filed against it';
  return null;
}

// Copies a whole directory tree. The receipts folder is nested by financial
// year and category, so this cannot be a flat loop over files.
function copyTree(from, to) {
  if (!fs.existsSync(from)) return 0;
  let copied = 0;

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copied += copyTree(source, target);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Never overwrite. The target was checked as empty, so anything already
      // there is a surprise, and a surprise is not something to write over.
      if (!fs.existsSync(target)) {
        fs.copyFileSync(source, target);
        copied += 1;
      }
    }
  }
  return copied;
}

export async function cloneAccount({ uploadsRoot, fromUserId, toUserId }) {
  if (Number(fromUserId) === Number(toUserId)) {
    return { ok: false, error: 'That is the same account' };
  }

  const problem = await targetProblem(toUserId);
  if (problem) return { ok: false, error: problem };

  const [sources] = await pool.execute('SELECT id FROM users WHERE id = ?', [fromUserId]);
  if (!sources[0]) return { ok: false, error: 'The account being copied from does not exist' };

  // Old id -> new id, so children can be repointed as they are inserted. Built
  // as the copy goes rather than resolved afterwards: an expense inserted
  // against the wrong category is a silent error nobody would notice.
  const entityMap = new Map();
  const categoryMap = new Map();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [entities] = await conn.execute('SELECT * FROM entities WHERE user_id = ?', [fromUserId]);
    for (const e of entities) {
      const [res] = await conn.execute(
        `INSERT INTO entities (user_id, name, kind, lodgement_cadence, is_default, path_segment, color, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [toUserId, e.name, e.kind, e.lodgement_cadence, e.is_default, e.path_segment, e.color, e.archived_at]
      );
      entityMap.set(e.id, res.insertId);
    }

    const [categories] = await conn.execute('SELECT * FROM categories WHERE user_id = ?', [fromUserId]);
    for (const c of categories) {
      const [res] = await conn.execute(
        'INSERT INTO categories (user_id, entity_id, name, color, icon) VALUES (?, ?, ?, ?, ?)',
        [toUserId, c.entity_id ? entityMap.get(c.entity_id) ?? null : null, c.name, c.color, c.icon]
      );
      categoryMap.set(c.id, res.insertId);
    }

    // receipt_path starts with the owner's id, so every one has to be rewritten
    // — a copied row still pointing into the source account's folder would read
    // its files and lose them when that account is deleted.
    const [expenses] = await conn.execute('SELECT * FROM expenses WHERE user_id = ?', [fromUserId]);
    for (const x of expenses) {
      const rewritten = x.receipt_path
        ? String(x.receipt_path).replace(new RegExp(`^${fromUserId}/`), `${toUserId}/`)
        : null;

      await conn.execute(
        `INSERT INTO expenses (user_id, category_id, entity_id, item_name, amount, currency, purchase_date,
           receipt_path, is_recurring, frequency, notes, business_use_pct, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          toUserId,
          x.category_id ? categoryMap.get(x.category_id) ?? null : null,
          x.entity_id ? entityMap.get(x.entity_id) ?? null : null,
          x.item_name,
          x.amount,
          x.currency,
          x.purchase_date,
          rewritten,
          x.is_recurring,
          x.frequency,
          x.notes,
          x.business_use_pct ?? null,
          x.deleted_at,
        ]
      );
    }

    const [documents] = await conn.execute('SELECT * FROM category_documents WHERE user_id = ?', [fromUserId]);
    for (const d of documents) {
      await conn.execute(
        `INSERT INTO category_documents (user_id, category_id, filename, original_name, document_name,
           financial_year, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          toUserId,
          d.category_id ? categoryMap.get(d.category_id) ?? null : null,
          d.filename,
          d.original_name,
          d.document_name,
          d.financial_year,
          d.size_bytes,
        ]
      );
    }

    // The flat, user-keyed tables. Columns are read from the row itself rather
    // than listed here, so a column added next year is carried across without
    // anybody remembering to update this.
    for (const table of RECORD_TABLES) {
      const [rows] = await conn.execute(`SELECT * FROM ${table} WHERE user_id = ?`, [fromUserId]);
      for (const row of rows) {
        const columns = Object.keys(row).filter((c) => c !== 'id');
        const values = columns.map((c) => (c === 'user_id' ? toUserId : row[c]));
        await conn.execute(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          values
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    conn.release();
    return { ok: false, error: `Nothing was copied: ${err.message}` };
  }
  conn.release();

  // Files last, and outside the transaction — they cannot be rolled back, so
  // they are done once the rows are certain. A failure here leaves rows
  // pointing at files that were not copied, which is recoverable by running it
  // again; the reverse would leave orphaned files nobody could account for.
  let files = 0;
  try {
    files = copyTree(
      path.join(userRootDir(uploadsRoot, fromUserId), RECEIPTS_SEGMENT),
      path.join(userRootDir(uploadsRoot, toUserId), RECEIPTS_SEGMENT)
    );
  } catch (err) {
    console.error('Records copied but files did not', err);
    return { ok: true, warning: `The records copied, but the receipt files did not: ${err.message}`, files: 0 };
  }

  return { ok: true, files, summary: await accountSummary(toUserId) };
}
