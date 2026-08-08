import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import { receiptDirFor, receiptRelDirFor } from './receiptStorage.js';

// Moving a category, its expenses and its receipt files from one set of books
// to another.
//
// This exists because somebody put a category under their individual tax and
// later decided it belongs to a business — a thing there was previously no way
// to undo short of retyping every expense and re-uploading every receipt.
//
// It is genuinely awkward, and worth saying why. A receipt's path on disk
// contains the entity it belongs to:
//
//   uploads/<user>/receipts/<entity>/<financial year>/<category>/<file>
//
// so moving a category between books is not a column update — every file has to
// move with it, and the paths recorded against each expense have to be rewritten
// to match. Nothing else in this codebase relocates a receipt: path_segment is
// generated once and deliberately never changed, precisely so renaming a set of
// books cannot move a file. This is the one operation that has to.
//
// The order below is the whole safety argument:
//
//   1. Copy every file to its new home. Nothing is destroyed yet, so a failure
//      here leaves the original intact and the database untouched.
//   2. Update the rows, in a transaction. If this fails, the copies are orphaned
//      — wasted space, but not a lost receipt.
//   3. Only then remove the originals, and only the ones that were copied.
//
// The reverse order — rows first, files second — is how a half-finished move
// leaves an expense pointing at a file that is no longer there, which looks
// exactly like a receipt somebody lost.

export async function planCategoryMove({ userId, categoryId, toEntityId, rule }) {
  const [categories] = await pool.execute(
    'SELECT id, name, entity_id FROM categories WHERE id = ? AND user_id = ?',
    [categoryId, userId]
  );
  const category = categories[0];
  if (!category) return { ok: false, error: 'That category is not yours' };

  const [entities] = await pool.execute(
    'SELECT id, name, kind, path_segment FROM entities WHERE id = ? AND user_id = ? AND archived_at IS NULL',
    [toEntityId, userId]
  );
  const target = entities[0];
  if (!target) return { ok: false, error: 'That set of books is not yours' };
  if (Number(category.entity_id) === Number(target.id)) {
    return { ok: false, error: 'It is already in that set of books' };
  }

  const [fromRows] = await pool.execute('SELECT path_segment FROM entities WHERE id = ?', [category.entity_id]);

  const [expenses] = await pool.execute(
    'SELECT id, purchase_date, receipt_path FROM expenses WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL',
    [userId, categoryId]
  );

  return {
    ok: true,
    category,
    target,
    fromSegment: fromRows[0]?.path_segment || null,
    expenses,
    // What the customer is told before deciding. A count of files is the part
    // that makes this feel like the real operation it is.
    summary: {
      categoryName: category.name,
      targetName: target.name,
      expenses: expenses.length,
      receipts: expenses.filter((e) => e.receipt_path).length,
    },
  };
}

export async function moveCategoryToEntity({ uploadsRoot, userId, categoryId, toEntityId, rule }) {
  const plan = await planCategoryMove({ userId, categoryId, toEntityId, rule });
  if (!plan.ok) return plan;

  const { category, target, fromSegment, expenses } = plan;
  const copied = [];

  // --- 1. Copy, destroying nothing ---------------------------------------
  for (const expense of expenses) {
    if (!expense.receipt_path) continue;

    const filename = path.basename(expense.receipt_path);
    const fromDir = receiptDirFor(uploadsRoot, userId, expense.purchase_date, category.name, rule, fromSegment);
    const toDir = receiptDirFor(uploadsRoot, userId, expense.purchase_date, category.name, rule, target.path_segment);
    const fromPath = path.join(fromDir, filename);
    const toPath = path.join(toDir, filename);

    // A row can point at a file that is no longer on disk — an older import, a
    // restore that missed one. That must not stop the rest of the move.
    if (!fs.existsSync(fromPath)) continue;

    fs.mkdirSync(toDir, { recursive: true });
    fs.copyFileSync(fromPath, toPath);

    copied.push({
      expenseId: expense.id,
      fromPath,
      relPath: [
        receiptRelDirFor(userId, expense.purchase_date, category.name, rule, target.path_segment),
        filename,
      ].join('/'),
    });
  }

  // --- 2. Rows, all or nothing -------------------------------------------
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute('UPDATE categories SET entity_id = ? WHERE id = ? AND user_id = ?', [
      target.id,
      categoryId,
      userId,
    ]);
    await conn.execute('UPDATE expenses SET entity_id = ? WHERE user_id = ? AND category_id = ?', [
      target.id,
      userId,
      categoryId,
    ]);

    for (const file of copied) {
      await conn.execute('UPDATE expenses SET receipt_path = ? WHERE id = ? AND user_id = ?', [
        file.relPath,
        file.expenseId,
        userId,
      ]);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    // The copies are left where they are. They are orphaned bytes, which is a
    // disk problem; deleting them here to be tidy would risk removing a file the
    // rollback has just pointed an expense back at.
    conn.release();
    return { ok: false, error: 'The move could not be completed, and nothing was changed.' };
  }
  conn.release();

  // --- 3. Only now, the originals ----------------------------------------
  for (const file of copied) {
    try {
      fs.rmSync(file.fromPath, { force: true });
    } catch (err) {
      // The move worked and the expense points at the new copy. A leftover
      // original is untidy and harmless, and is not worth failing over.
      console.error(`Could not remove the old receipt at ${file.fromPath}`, err.message);
    }
  }

  return { ok: true, moved: { expenses: expenses.length, receipts: copied.length }, summary: plan.summary };
}
