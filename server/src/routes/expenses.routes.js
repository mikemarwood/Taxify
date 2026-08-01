import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { requireAuth, requireActiveAccess } from '../auth/middleware.js';
import { getVisibleUserIds, expenseScope, financialYearRuleFor } from '../auth/access.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { financialYearOf } from '../lib/financialYear.js';
import { resolveCategoryForYear } from '../lib/categoryYears.js';
import { blockIfFinalised, finalisedYearsFor } from '../lib/finalisedYears.js';
import { viewableCopy } from '../lib/heicPreview.js';
import { MAX_UPLOAD_BYTES, isAllowedUpload, UPLOAD_REJECTED_MESSAGE } from '../lib/uploadRules.js';
import { advanceDate } from '../lib/recurrence.js';
import { receiptDirFor, receiptRelDirFor, assertWithin, uniqueFilenameIn } from '../lib/receiptStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Receipt uploads follow the shared rules in lib/uploadRules.js, so what an
// expense accepts and what a category document accepts can't drift apart.

// The account's financial-year rule decides which year folder a receipt
// lands in, so it travels with every path built here.
function dirFor(userId, purchaseDate, categoryName, rule) {
  return receiptDirFor(uploadsDir, userId, purchaseDate, categoryName, rule);
}

async function categoryNameFor(userId, categoryId) {
  if (!categoryId) return 'Uncategorised';
  const [rows] = await pool.execute('SELECT name FROM categories WHERE id = ? AND user_id = ?', [categoryId, userId]);
  return rows[0]?.name || 'Uncategorised';
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const categoryName = await categoryNameFor(req.user.id, req.body?.categoryId);
      const purchaseDate = req.body?.purchaseDate || new Date().toISOString();
      const dir = dirFor(req.user.id, purchaseDate, categoryName, req.user.financialYearRule);
      fs.mkdirSync(dir, { recursive: true });
      req._uploadDir = dir;
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  // The file keeps the name it arrived with, cleaned up to something the
  // safe-filename guard accepts, and is only ever suffixed when that name is
  // already taken — a receipt called "bunnings-invoice.pdf" is worth more at
  // a glance than "1739246...-a1b2c3.pdf".
  filename: (req, file, cb) => {
    req._takenNames = req._takenNames || new Set();
    cb(null, uniqueFilenameIn(req._uploadDir, file.originalname, req._takenNames));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file)) return cb(Object.assign(new Error(UPLOAD_REJECTED_MESSAGE), { status: 400 }));
    cb(null, true);
  },
});

// One receipt can cover several expenses — a single shop docket spanning three
// line items, say — so receipt_path is not unique. A file must therefore only
// be deleted or relocated once nothing else points at it. The same filename in
// a different folder is a different file, so the derived directory is compared
// too, not just the name.
async function otherExpensesUsingReceipt(dbPool, user, receiptPath, dir, excludeExpenseId) {
  if (!receiptPath) return 0;
  const [rows] = await dbPool.execute(
    `SELECT e.id, e.purchase_date, c.name AS category_name
     FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = ? AND e.receipt_path = ? AND e.deleted_at IS NULL AND e.id <> ?`,
    [user.id, receiptPath, excludeExpenseId || 0]
  );
  return rows.filter((r) => dirFor(user.id, r.purchase_date, r.category_name || 'Uncategorised', user.financialYearRule) === dir).length;
}

const TRASH_RETENTION_DAYS = 30;

export async function purgeExpiredTrash(dbPool) {
  const [rows] = await dbPool.execute(
    `SELECT e.id, e.user_id, e.receipt_path, e.purchase_date, c.name AS category_name
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < DATE_SUB(NOW(), INTERVAL ${TRASH_RETENTION_DAYS} DAY)`
  );
  if (rows.length === 0) return;

  // A background job has no request to read the year rule from, so each row's
  // own account has to be asked. Cached, because one purge usually covers
  // several rows belonging to the same person.
  const ruleCache = new Map();
  async function ruleFor(userId) {
    if (!ruleCache.has(userId)) ruleCache.set(userId, await financialYearRuleFor(userId));
    return ruleCache.get(userId);
  }

  for (const row of rows) {
    if (row.receipt_path) {
      const rule = await ruleFor(row.user_id);
      const dir = receiptDirFor(uploadsDir, row.user_id, row.purchase_date, row.category_name, rule);
      // Keep the file if a live expense still shares it.
      const stillUsed = await otherExpensesUsingReceipt(
        dbPool,
        { id: row.user_id, financialYearRule: rule },
        row.receipt_path,
        dir,
        row.id
      );
      if (stillUsed === 0) fs.unlink(path.join(dir, row.receipt_path), () => {});
    }
  }
  await dbPool.query(
    `DELETE FROM expenses WHERE id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id)
  );
}

const router = Router();
router.use(requireAuth, requireActiveAccess);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // An accountant may have been given only part of the history, so the scope
    // carries the year restriction as well as whose rows may be read.
    const scope = await expenseScope(req.user);
    const [rows] = await pool.execute(
      `SELECT e.id, e.user_id, e.item_name, e.amount, e.currency, e.purchase_date, e.receipt_path,
              e.is_recurring, e.frequency, e.notes, e.created_at, e.updated_at, e.auto_generated,
              creator.name AS created_by_name, editor.name AS updated_by_name,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN users creator ON creator.id = e.created_by
       LEFT JOIN users editor ON editor.id = e.updated_by
       WHERE ${scope.clause} AND e.deleted_at IS NULL
       ORDER BY e.purchase_date DESC, e.id DESC`,
      scope.params
    );

    const expenses = rows.map((r) => ({
      id: r.id,
      itemName: r.item_name,
      amount: Number(r.amount),
      currency: r.currency,
      purchaseDate: r.purchase_date,
      financialYear: financialYearOf(r.purchase_date, req.user.financialYearRule),
      receiptUrl: r.receipt_path ? `/api/expenses/${r.id}/receipt` : null,
      receiptFilename: r.receipt_path || null,
      // Where the file actually sits: relative for the inbox breadcrumbs, and
      // the full directory so an expense can be opened straight from Explorer.
      receiptPath: r.receipt_path
        ? `${receiptRelDirFor(r.user_id, r.purchase_date, r.category_name || 'Uncategorised', req.user.financialYearRule)}/${r.receipt_path}`
        : null,
      receiptDir: r.receipt_path
        ? receiptDirFor(uploadsDir, r.user_id, r.purchase_date, r.category_name || 'Uncategorised', req.user.financialYearRule)
        : null,
      receiptFullPath: r.receipt_path
        ? path.join(
            receiptDirFor(uploadsDir, r.user_id, r.purchase_date, r.category_name || 'Uncategorised', req.user.financialYearRule),
            r.receipt_path
          )
        : null,
      isRecurring: !!r.is_recurring,
      frequency: r.frequency,
      notes: r.notes,
      createdAt: r.created_at,
      // On a Family plan either person can add and edit, so "who put this in?"
      // is a question the row has to be able to answer.
      createdByName: r.created_by_name || null,
      updatedByName: r.updated_by_name || null,
      updatedAt: r.updated_at || null,
      autoGenerated: !!r.auto_generated,
      category: r.category_id
        ? { id: r.category_id, name: r.category_name, color: r.category_color, icon: r.category_icon }
        : null,
    }));

    // Which years are closed travels with the list, so the app can show a
    // year as locked rather than letting someone edit and be refused.
    res.json({ expenses, finalisedYears: await finalisedYearsFor(req.user) });
  })
);

// The financial years this account actually has expenses in. Every year picker
// in the app should be built from this rather than from a fixed range — an
// account that started last year has no business offering 2019-2020.
router.get(
  '/years',
  asyncHandler(async (req, res) => {
    const scope = await expenseScope(req.user);
    const [rows] = await pool.execute(
      `SELECT DISTINCT purchase_date FROM expenses e WHERE ${scope.clause} AND e.deleted_at IS NULL`,
      scope.params
    );
    const years = Array.from(new Set(rows.map((r) => financialYearOf(r.purchase_date, req.user.financialYearRule)).filter(Boolean)))
      .sort()
      .reverse();
    res.json({ years, current: financialYearOf(new Date().toISOString().slice(0, 10), req.user.financialYearRule) });
  })
);

router.get(
  '/auto-generated/unnotified',
  asyncHandler(async (req, res) => {
    const visibleUserIds = await getVisibleUserIds(req.user);
    const [rows] = await pool.execute(
      `SELECT id, item_name, amount, currency, purchase_date FROM expenses
       WHERE user_id IN (${visibleUserIds.map(() => '?').join(',')}) AND auto_generated = 1 AND notified_at IS NULL`,
      visibleUserIds
    );

    if (rows.length > 0) {
      await pool.query(
        `UPDATE expenses SET notified_at = NOW() WHERE id IN (${rows.map(() => '?').join(',')})`,
        rows.map((r) => r.id)
      );
    }

    res.json({
      expenses: rows.map((r) => ({
        id: r.id,
        itemName: r.item_name,
        amount: Number(r.amount),
        currency: r.currency,
        purchaseDate: r.purchase_date,
      })),
    });
  })
);

router.get(
  '/trash',
  asyncHandler(async (req, res) => {
    await purgeExpiredTrash(pool);

    const [rows] = await pool.execute(
      `SELECT e.id, e.item_name, e.amount, e.currency, e.purchase_date, e.receipt_path,
              e.is_recurring, e.frequency, e.notes, e.created_at, e.deleted_at, e.auto_generated,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = ? AND e.deleted_at IS NOT NULL
       ORDER BY e.deleted_at DESC`,
      [req.user.id]
    );

    const expenses = rows.map((r) => {
      const deletedAt = new Date(r.deleted_at);
      const purgeAt = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const daysRemaining = Math.max(0, Math.ceil((purgeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
      return {
        id: r.id,
        itemName: r.item_name,
        amount: Number(r.amount),
        currency: r.currency,
        purchaseDate: r.purchase_date,
        financialYear: financialYearOf(r.purchase_date, req.user.financialYearRule),
        receiptUrl: r.receipt_path ? `/api/expenses/${r.id}/receipt` : null,
        isRecurring: !!r.is_recurring,
        frequency: r.frequency,
        notes: r.notes,
        createdAt: r.created_at,
        deletedAt: r.deleted_at,
        daysRemaining,
        autoGenerated: !!r.auto_generated,
        category: r.category_id
          ? { id: r.category_id, name: r.category_name, color: r.category_color, icon: r.category_icon }
          : null,
      };
    });

    res.json({ expenses });
  })
);

router.post(
  '/',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    const cleanupUpload = () => {
      if (req.file) fs.unlink(req.file.path, () => {});
    };

    try {
      const { itemName, amount, currency, purchaseDate, categoryId, notes, isRecurring, frequency } = req.body || {};

      if (!itemName || !String(itemName).trim()) {
        cleanupUpload();
        return res.status(400).json({ error: 'Item name is required' });
      }
      if (String(itemName).trim().length > 200) {
        cleanupUpload();
        return res.status(400).json({ error: 'Item name must be 200 characters or fewer' });
      }
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        cleanupUpload();
        return res.status(400).json({ error: 'A valid amount is required' });
      }
      if (amountNum > 999999.99) {
        cleanupUpload();
        return res.status(400).json({ error: 'Amount is too large' });
      }
      if (!purchaseDate) {
        cleanupUpload();
        return res.status(400).json({ error: 'Purchase date is required' });
      }
      if (notes && String(notes).length > 1000) {
        cleanupUpload();
        return res.status(400).json({ error: 'Notes must be 1000 characters or fewer' });
      }

      const closed = await blockIfFinalised(req.user, purchaseDate);
      if (closed) {
        cleanupUpload();
        return res.status(409).json({ error: closed });
      }

      let newCategoryName = 'Uncategorised';
      let resolvedCategoryId = null;
      if (categoryId) {
        // Categories belong to a financial year, so the one that gets saved is
        // the one for the year this expense falls in — not whichever year's
        // list it happened to be picked from.
        resolvedCategoryId = await resolveCategoryForYear(pool, req.user.id, categoryId, purchaseDate, req.user.financialYearRule);
        if (resolvedCategoryId === undefined) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid category' });
        }
        const [categoryRows] = await pool.execute('SELECT name FROM categories WHERE id = ?', [resolvedCategoryId]);
        newCategoryName = categoryRows[0]?.name || 'Uncategorised';
      }

      let receiptPath = req.file ? req.file.filename : null;
      const recurring = isRecurring === 'true' || isRecurring === true;
      const nextDueDate = recurring ? advanceDate(purchaseDate, frequency) : null;

      const [result] = await pool.execute(
        `INSERT INTO expenses (user_id, created_by, category_id, item_name, amount, currency, purchase_date, receipt_path, is_recurring, frequency, notes, next_due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          req.user.id,
          resolvedCategoryId,
          String(itemName).trim(),
          amountNum,
          currency || 'AUD',
          purchaseDate,
          receiptPath,
          recurring ? 1 : 0,
          frequency || null,
          notes || null,
          nextDueDate,
        ]
      );

      res.status(201).json({ id: result.insertId });
    } catch (err) {
      cleanupUpload();
      throw err;
    }
  })
);

router.patch(
  '/:id',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    const cleanupUpload = () => {
      if (req.file) fs.unlink(req.file.path, () => {});
    };

    try {
      const [existingRows] = await pool.execute('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [
        req.params.id,
        req.user.id,
      ]);
      const existing = existingRows[0];
      if (!existing) {
        cleanupUpload();
        return res.status(404).json({ error: 'Expense not found' });
      }

      const { itemName, amount, currency, purchaseDate, categoryId, notes, isRecurring, frequency, removeReceipt } = req.body || {};

      if (!itemName || !String(itemName).trim()) {
        cleanupUpload();
        return res.status(400).json({ error: 'Item name is required' });
      }
      if (String(itemName).trim().length > 200) {
        cleanupUpload();
        return res.status(400).json({ error: 'Item name must be 200 characters or fewer' });
      }
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        cleanupUpload();
        return res.status(400).json({ error: 'A valid amount is required' });
      }
      if (amountNum > 999999.99) {
        cleanupUpload();
        return res.status(400).json({ error: 'Amount is too large' });
      }
      if (!purchaseDate) {
        cleanupUpload();
        return res.status(400).json({ error: 'Purchase date is required' });
      }
      if (notes && String(notes).length > 1000) {
        cleanupUpload();
        return res.status(400).json({ error: 'Notes must be 1000 characters or fewer' });
      }

      // Both dates: moving an expense across the boundary changes two years,
      // and either being closed is a reason to refuse.
      const closed = await blockIfFinalised(req.user, purchaseDate, existing.purchase_date);
      if (closed) {
        cleanupUpload();
        return res.status(409).json({ error: closed });
      }

      let newCategoryName = 'Uncategorised';
      let resolvedCategoryId = null;
      if (categoryId) {
        // Moving an expense into another financial year moves it onto that
        // year's category too, so the year it is counted in and the category
        // it is counted under never disagree.
        resolvedCategoryId = await resolveCategoryForYear(pool, req.user.id, categoryId, purchaseDate, req.user.financialYearRule);
        if (resolvedCategoryId === undefined) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid category' });
        }
        const [categoryRows] = await pool.execute('SELECT name FROM categories WHERE id = ?', [resolvedCategoryId]);
        newCategoryName = categoryRows[0]?.name || 'Uncategorised';
      }

      const oldCategoryName = await categoryNameFor(req.user.id, existing.category_id);
      const oldDir = dirFor(req.user.id, existing.purchase_date, oldCategoryName, req.user.financialYearRule);
      const newDir = dirFor(req.user.id, purchaseDate, newCategoryName, req.user.financialYearRule);

      let receiptPath = existing.receipt_path;
      let deleteOldAbsPath = null;
      let moveFrom = null;
      let moveTo = null;

      if (req.file) {
        if (existing.receipt_path) deleteOldAbsPath = path.join(oldDir, existing.receipt_path);
        receiptPath = req.file.filename;
      } else if (removeReceipt === 'true' || removeReceipt === true) {
        if (existing.receipt_path) deleteOldAbsPath = path.join(oldDir, existing.receipt_path);
        receiptPath = null;
      } else if (existing.receipt_path && oldDir !== newDir) {
        // Changing the category or the date changes which folder the receipt
        // belongs in, so it moves with the expense. The destination name is
        // resolved before the row is written, so the database records the name
        // the file actually ends up with rather than the one it had.
        fs.mkdirSync(newDir, { recursive: true });
        const storedName = uniqueFilenameIn(newDir, existing.receipt_path);
        moveFrom = path.join(oldDir, existing.receipt_path);
        moveTo = path.join(newDir, storedName);
        receiptPath = storedName;
      }

      const recurring = isRecurring === 'true' || isRecurring === true;
      const nextDueDate = recurring ? advanceDate(purchaseDate, frequency) : null;

      await pool.execute(
        `UPDATE expenses SET category_id = ?, item_name = ?, amount = ?, currency = ?, purchase_date = ?, receipt_path = ?, is_recurring = ?, frequency = ?, notes = ?, next_due_date = ?,
         updated_by = ?, updated_at = NOW()
         WHERE id = ? AND user_id = ?`,
        [
          resolvedCategoryId,
          String(itemName).trim(),
          amountNum,
          currency || existing.currency || 'AUD',
          purchaseDate,
          receiptPath,
          recurring ? 1 : 0,
          frequency || null,
          notes || null,
          nextDueDate,
          req.user.id,
          req.params.id,
          req.user.id,
        ]
      );

      if (deleteOldAbsPath) {
        const stillUsed = await otherExpensesUsingReceipt(pool, req.user, existing.receipt_path, oldDir, req.params.id);
        if (stillUsed === 0) fs.unlink(deleteOldAbsPath, () => {});
      }
      if (moveFrom && moveTo) {
        fs.mkdirSync(newDir, { recursive: true });
        // Another expense still points at the old location, so leave a copy
        // behind rather than moving the file out from under it.
        const stillUsed = await otherExpensesUsingReceipt(pool, req.user, existing.receipt_path, oldDir, req.params.id);
        if (stillUsed > 0) {
          try {
            fs.copyFileSync(moveFrom, moveTo);
          } catch (err) {
            console.error('Failed to copy shared receipt file', err);
          }
        } else {
          fs.rename(moveFrom, moveTo, (err) => {
            if (err) console.error('Failed to relocate receipt file', err);
          });
        }
      }

      res.json({ ok: true });
    } catch (err) {
      cleanupUpload();
      throw err;
    }
  })
);

router.get(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT e.receipt_path, e.item_name, e.purchase_date, c.name AS category_name
       FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.id = ? AND e.user_id = ?`,
      [req.params.id, req.user.id]
    );
    const row = rows[0];
    if (!row || !row.receipt_path) return res.status(404).json({ error: 'Receipt not found' });
    const dir = dirFor(req.user.id, row.purchase_date, row.category_name || 'Uncategorised', req.user.financialYearRule);
    const filePath = assertWithin(uploadsDir, path.join(dir, row.receipt_path));
    if (req.query.download) {
      const ext = path.extname(row.receipt_path);
      const safeName = row.item_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return res.download(filePath, `receipt-${safeName || 'expense'}${ext}`);
    }
    res.sendFile((await viewableCopy(uploadsDir, filePath)) || filePath);
  })
);

// Soft delete. `deleteReceipt` additionally removes the receipt file straight
// away rather than leaving it for the 30-day purge — the caller has to ask for
// it, because restoring from the recycle bin can't bring the file back.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT e.id, e.receipt_path, e.purchase_date, c.name AS category_name
       FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.id = ? AND e.user_id = ? AND e.deleted_at IS NULL`,
      [req.params.id, req.user.id]
    );
    const expense = rows[0];
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const closed = await blockIfFinalised(req.user, expense.purchase_date);
    if (closed) return res.status(409).json({ error: closed });

    const wanted = req.query.deleteReceipt === 'true' || req.body?.deleteReceipt === true;
    let receiptDeleted = false;

    if (wanted && expense.receipt_path) {
      const dir = dirFor(req.user.id, expense.purchase_date, expense.category_name || 'Uncategorised', req.user.financialYearRule);
      // One docket can cover several expenses, so the file only goes if this
      // was the last expense pointing at it.
      const stillUsed = await otherExpensesUsingReceipt(pool, req.user, expense.receipt_path, dir, expense.id);
      if (stillUsed === 0) {
        try {
          fs.unlinkSync(path.join(dir, expense.receipt_path));
          receiptDeleted = true;
        } catch {
          // already gone — the row still needs clearing below
          receiptDeleted = true;
        }
      }
    }

    await pool.execute(
      `UPDATE expenses SET deleted_at = NOW()${receiptDeleted ? ', receipt_path = NULL' : ''} WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true, receiptDeleted });
  })
);

router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT id, purchase_date FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Expense not found in recycle bin' });

    // Restoring puts a row back into a year's totals, so a closed year refuses
    // it for the same reason it refuses a new one.
    const closed = await blockIfFinalised(req.user, rows[0].purchase_date);
    if (closed) return res.status(409).json({ error: closed });

    await pool.execute('UPDATE expenses SET deleted_at = NULL WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id/permanent',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT e.receipt_path, e.purchase_date, c.name AS category_name
       FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.id = ? AND e.user_id = ? AND e.deleted_at IS NOT NULL`,
      [req.params.id, req.user.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Expense not found in recycle bin' });

    await pool.execute('DELETE FROM expenses WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (row.receipt_path) {
      const dir = dirFor(req.user.id, row.purchase_date, row.category_name || 'Uncategorised', req.user.financialYearRule);
      const stillUsed = await otherExpensesUsingReceipt(pool, req.user, row.receipt_path, dir, req.params.id);
      if (stillUsed === 0) fs.unlink(path.join(dir, row.receipt_path), () => {});
    }
    res.json({ ok: true });
  })
);

export default router;
