import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { requireAuth, requireActiveAccess } from '../auth/middleware.js';
import { getVisibleUserIds, expenseScope, financialYearRuleFor, dataOwnerId } from '../auth/access.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { financialYearOf } from '../lib/financialYear.js';
import { resolveCategoryForYear } from '../lib/categoryYears.js';
import { blockIfFinalised, finalisedYearsFor } from '../lib/finalisedYears.js';
import { resolveWriteEntity } from '../lib/entities.js';
import { viewableCopy } from '../lib/heicPreview.js';
import { serveAttachment } from '../lib/serveAttachment.js';
import { MAX_UPLOAD_BYTES, isAllowedUpload, UPLOAD_REJECTED_MESSAGE } from '../lib/uploadRules.js';
import { advanceDate } from '../lib/recurrence.js';
import { resolveBaseAmount } from '../lib/fx.js';
import { isKnownCurrency } from '../lib/geoData.js';
import { suggestCategory } from '../lib/categorySuggest.js';
import { receiptDirFor, receiptRelDirFor, assertWithin, uniqueFilenameIn } from '../lib/receiptStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Receipt uploads follow the shared rules in lib/uploadRules.js, so what an
// expense accepts and what a category document accepts can't drift apart.

// The account's financial-year rule decides which year folder a receipt lands
// in, and the set of books decides whether there is a folder above that — so
// both travel with every path built here. The default books have no segment, so
// their paths are byte-for-byte what they were before entities existed.
function dirFor(userId, purchaseDate, categoryName, rule, entitySegment = null) {
  return receiptDirFor(uploadsDir, userId, purchaseDate, categoryName, rule, entitySegment);
}

// The folder segment for the books a request is about. Read from the row rather
// than derived from the name, because the name can change and a receipt must
// never move because somebody renamed their business.
function entitySegmentOf(user) {
  return user?.entity?.path_segment || null;
}

// The segment for a specific set of books, whichever ones a row belongs to —
// not whichever ones happen to be selected. Needed wherever a path is built for
// an existing expense rather than for the request.
async function segmentForEntity(entityId) {
  if (!entityId) return null;
  const [rows] = await pool.execute('SELECT path_segment FROM entities WHERE id = ?', [entityId]);
  return rows[0]?.path_segment || null;
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
      // The form's own entity wins over the selected one, because a receipt can
      // be added from the combined view where nothing is selected. This works
      // only because the client appends entityId before the file — multer runs
      // this callback mid-stream, so it can only see fields that came first.
      // The same reason the category upload appends financialYear first.
      const segment = req.body?.entityId
        ? await segmentForEntity(Number(req.body.entityId))
        : entitySegmentOf(req.user);
      const dir = dirFor(req.user.id, purchaseDate, categoryName, req.user.financialYearRule, segment);
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
  // Each row's own set of books, not the request's. Two entities can hold the
  // same filename in the same category name, and without joining out the
  // segment this would compare one of them against the other's directory —
  // concluding nothing else uses the file, and deleting one that is still in
  // use. The join is what stops that.
  const [rows] = await dbPool.execute(
    `SELECT e.id, e.purchase_date, c.name AS category_name, en.path_segment
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN entities en ON en.id = e.entity_id
     WHERE e.user_id = ? AND e.receipt_path = ? AND e.deleted_at IS NULL AND e.id <> ?`,
    [user.id, receiptPath, excludeExpenseId || 0]
  );
  return rows.filter(
    (r) =>
      dirFor(user.id, r.purchase_date, r.category_name || 'Uncategorised', user.financialYearRule, r.path_segment) ===
      dir
  ).length;
}

const TRASH_RETENTION_DAYS = 30;

export async function purgeExpiredTrash(dbPool) {
  const [rows] = await dbPool.execute(
    `SELECT e.id, e.user_id, e.receipt_path, e.purchase_date, c.name AS category_name, en.path_segment
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN entities en ON en.id = e.entity_id
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
      const dir = receiptDirFor(uploadsDir, row.user_id, row.purchase_date, row.category_name, rule, row.path_segment);
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
              e.base_amount, e.base_currency, e.fx_rate, e.fx_rate_source, e.business_use_pct,
              creator.name AS created_by_name, editor.name AS updated_by_name,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
              en.id AS entity_id, en.name AS entity_name, en.kind AS entity_kind, en.is_default AS entity_is_default
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN entities en ON en.id = e.entity_id
       LEFT JOIN users creator ON creator.id = e.created_by
       LEFT JOIN users editor ON editor.id = e.updated_by
       WHERE ${scope.clause} AND e.deleted_at IS NULL
       ORDER BY e.purchase_date DESC, e.id DESC`,
      scope.params
    );

    const expenses = rows.map((r) => ({
      id: r.id,
      // Carried on every row so a combined list can say which books each one is
      // in. Two businesses can each have a Tooling category, and without this
      // they are indistinguishable in a list that shows both.
      entity: r.entity_id
        ? { id: r.entity_id, name: r.entity_name, kind: r.entity_kind, isDefault: !!r.entity_is_default }
        : null,
      itemName: r.item_name,
      amount: Number(r.amount),
      currency: r.currency,
      // What every total sums. Null when the row could not be converted —
      // reported rather than counted at face value.
      baseAmount: r.base_amount === null ? null : Number(r.base_amount),
      baseCurrency: r.base_currency,
      businessUsePct: r.business_use_pct === null ? 100 : Number(r.business_use_pct),
      fxRate: r.fx_rate === null ? null : Number(r.fx_rate),
      fxRateSource: r.fx_rate_source,
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

    // ?entityIds=4,9 narrows to particular books. Each id is checked against
    // this account's own before it goes anywhere near the query — the ids come
    // from a URL, and the scope clause alone does not constrain which of your
    // books you asked about.
    const asked = String(req.query?.entityIds || '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);

    let extraClause = '';
    const extraParams = [];
    if (asked.length > 0) {
      const [owned] = await pool.execute(
        'SELECT id FROM entities WHERE user_id = ? AND archived_at IS NULL',
        [dataOwnerId(req.user)]
      );
      const mine = asked.filter((id) => owned.some((o) => o.id === id));
      if (mine.length > 0) {
        extraClause = ` AND e.entity_id IN (${mine.map(() => '?').join(',')})`;
        extraParams.push(...mine);
      }
    }

    const [rows] = await pool.execute(
      `SELECT DISTINCT purchase_date FROM expenses e
        WHERE ${scope.clause} AND e.deleted_at IS NULL${extraClause}`,
      [...scope.params, ...extraParams]
    );
    const years = Array.from(new Set(rows.map((r) => financialYearOf(r.purchase_date, req.user.financialYearRule)).filter(Boolean)))
      .sort()
      .reverse();
    res.json({ years, current: financialYearOf(new Date().toISOString().slice(0, 10), req.user.financialYearRule) });
  })
);

// What category this probably is, judged against everything the account has
// filed before. Deliberately a suggestion the form pre-selects rather than a
// decision — it comes back with what it learned from, so it can be disagreed
// with.
router.get(
  '/suggest-category',
  asyncHandler(async (req, res) => {
    const itemName = String(req.query.itemName || '').trim();
    if (itemName.length < 2) return res.json({ suggestion: null });

    const scope = await expenseScope(req.user);
    const [rows] = await pool.execute(
      `SELECT e.item_name, c.name AS category_name, COUNT(*) AS n, MAX(e.purchase_date) AS last_used
       FROM expenses e
       JOIN categories c ON c.id = e.category_id
       WHERE ${scope.clause} AND e.deleted_at IS NULL
       GROUP BY e.item_name, c.name
       ORDER BY MAX(e.purchase_date) DESC
       LIMIT 2000`,
      scope.params
    );

    res.json({
      suggestion: suggestCategory(
        itemName,
        rows.map((r) => ({
          itemName: r.item_name,
          categoryName: r.category_name,
          count: r.n,
          lastUsed: r.last_used,
        }))
      ),
    });
  })
);

// Quotes the conversion without saving anything, so the form can show what an
// expense will be worth before it is committed. Same code path as the save, so
// the preview cannot disagree with the result.
router.get(
  '/fx-quote',
  asyncHandler(async (req, res) => {
    const amount = Number(req.query.amount);
    const money = await resolveBaseAmount({
      amount: Number.isFinite(amount) ? amount : 0,
      currency: req.query.currency,
      baseCurrency: req.user.currency || 'AUD',
      purchaseDate: req.query.purchaseDate,
      manualRate: req.query.fxRate || undefined,
    });

    if (money.error) return res.json({ error: money.error, needsRate: !!money.needsRate });
    res.json({
      baseAmount: money.baseAmount,
      baseCurrency: money.baseCurrency,
      rate: money.rate,
      source: money.source,
      rateDate: money.rateDate,
    });
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

router.post(
  '/',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    const cleanupUpload = () => {
      if (req.file) fs.unlink(req.file.path, () => {});
    };

    try {
      const { itemName, amount, currency, purchaseDate, categoryId, notes, isRecurring, frequency } = req.body || {};

      // Which set of books this belongs to. The combined view is a way of
      // looking, not a place to file, so it is refused here rather than guessed
      // at — the form sends an entity explicitly when nothing is selected.
      let entityId;
      try {
        // Validated against the account rather than trusted, so a stray id
        // cannot file the row into books that are not yours.
        entityId = await resolveWriteEntity(req.user, req.user.id, req.body?.entityId);
      } catch (err) {
        cleanupUpload();
        return res.status(400).json({ error: err.message });
      }

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

      const closed = await blockIfFinalised(req.user, { entityId, dates: [purchaseDate] });
      if (closed) {
        cleanupUpload();
        return res.status(409).json({ error: closed });
      }

      // Currency was written straight through with no validation at all —
      // any ten characters were accepted into a column every total reads.
      const finalCurrency = isKnownCurrency(currency) ? String(currency).toUpperCase() : null;
      if (currency && !finalCurrency) {
        cleanupUpload();
        return res.status(400).json({ error: 'That is not a currency we support' });
      }

      // A claim of 0% is not an expense and over 100% is not a thing. Absent
      // means the whole amount, which is what every existing row is.
      const businessUsePct =
        req.body?.businessUsePct === undefined || req.body?.businessUsePct === ''
          ? 100
          : Number(req.body.businessUsePct);
      if (!Number.isFinite(businessUsePct) || businessUsePct <= 0 || businessUsePct > 100) {
        cleanupUpload();
        return res.status(400).json({ error: 'Business use must be between 1 and 100 percent' });
      }

      // Anything not in the account's own currency is converted at the rate
      // for the purchase date, so every total is in one currency and means
      // something. Refused rather than guessed when no rate can be had.
      const money = await resolveBaseAmount({
        amount: amountNum,
        currency: finalCurrency || req.user.currency || 'AUD',
        baseCurrency: req.user.currency || 'AUD',
        purchaseDate,
        manualRate: req.body?.fxRate,
      });
      if (money.error) {
        cleanupUpload();
        return res.status(422).json({ error: money.error, needsRate: !!money.needsRate });
      }

      let newCategoryName = 'Uncategorised';
      let resolvedCategoryId = null;
      if (categoryId) {
        // Categories belong to a financial year, so the one that gets saved is
        // the one for the year this expense falls in — not whichever year's
        // list it happened to be picked from.
        resolvedCategoryId = await resolveCategoryForYear(pool, req.user.id, entityId, categoryId, purchaseDate, req.user.financialYearRule);
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
        `INSERT INTO expenses (user_id, entity_id, created_by, category_id, item_name, amount, currency, purchase_date,
           receipt_path, is_recurring, frequency, notes, next_due_date,
           base_currency, base_amount, fx_rate, fx_rate_source, fx_rate_date, business_use_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          entityId,
          req.user.id,
          resolvedCategoryId,
          String(itemName).trim(),
          amountNum,
          finalCurrency || req.user.currency || 'AUD',
          purchaseDate,
          receiptPath,
          recurring ? 1 : 0,
          frequency || null,
          notes || null,
          nextDueDate,
          money.baseCurrency,
          money.baseAmount,
          money.rate,
          money.source,
          money.rateDate,
          businessUsePct,
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

      // An expense stays where it is unless the request says otherwise. It may
      // move between sets of books — filed against the wrong business is a
      // mistake worth being able to correct — and the receipt follows it,
      // through the same relocation the category and date changes already use.
      const entityId = Number(req.body?.entityId) || existing.entity_id;
      if (!entityId) {
        cleanupUpload();
        return res.status(400).json({ error: 'Choose which business this belongs to' });
      }

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
      const closed = await blockIfFinalised(req.user, { entityId, dates: [purchaseDate, existing.purchase_date] });
      if (closed) {
        cleanupUpload();
        return res.status(409).json({ error: closed });
      }

      const editCurrency = currency
        ? isKnownCurrency(currency)
          ? String(currency).toUpperCase()
          : null
        : existing.currency || req.user.currency || 'AUD';
      if (!editCurrency) {
        cleanupUpload();
        return res.status(400).json({ error: 'That is not a currency we support' });
      }

      // Re-converted on every edit, because changing the amount, the currency
      // or the date all change what the figure in the account's own currency
      // should be.
      // A claim of 0% is not an expense and over 100% is not a thing. Absent
      // means the whole amount, which is what every existing row is.
      const businessUsePct =
        req.body?.businessUsePct === undefined || req.body?.businessUsePct === ''
          ? 100
          : Number(req.body.businessUsePct);
      if (!Number.isFinite(businessUsePct) || businessUsePct <= 0 || businessUsePct > 100) {
        cleanupUpload();
        return res.status(400).json({ error: 'Business use must be between 1 and 100 percent' });
      }

      // Anything not in the account's own currency is converted at the rate
      // for the purchase date, so every total is in one currency and means
      // something. Refused rather than guessed when no rate can be had.
      const money = await resolveBaseAmount({
        amount: amountNum,
        currency: editCurrency,
        baseCurrency: req.user.currency || 'AUD',
        purchaseDate,
        manualRate: req.body?.fxRate,
      });
      if (money.error) {
        cleanupUpload();
        return res.status(422).json({ error: money.error, needsRate: !!money.needsRate });
      }

      let newCategoryName = 'Uncategorised';
      let resolvedCategoryId = null;
      if (categoryId) {
        // Moving an expense into another financial year moves it onto that
        // year's category too, so the year it is counted in and the category
        // it is counted under never disagree.
        resolvedCategoryId = await resolveCategoryForYear(pool, req.user.id, entityId, categoryId, purchaseDate, req.user.financialYearRule);
        if (resolvedCategoryId === undefined) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid category' });
        }
        const [categoryRows] = await pool.execute('SELECT name FROM categories WHERE id = ?', [resolvedCategoryId]);
        newCategoryName = categoryRows[0]?.name || 'Uncategorised';
      }

      const oldCategoryName = await categoryNameFor(req.user.id, existing.category_id);
      // Each side reads its own set of books. Moving an expense from one
      // business to another changes the folder above the year, and using the
      // same segment for both would leave the file behind while the row moved.
      const oldSegment = await segmentForEntity(existing.entity_id);
      const newSegment = await segmentForEntity(entityId);
      const oldDir = dirFor(req.user.id, existing.purchase_date, oldCategoryName, req.user.financialYearRule, oldSegment);
      const newDir = dirFor(req.user.id, purchaseDate, newCategoryName, req.user.financialYearRule, newSegment);

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
        `UPDATE expenses SET entity_id = ?, category_id = ?, item_name = ?, amount = ?, currency = ?, purchase_date = ?, receipt_path = ?, is_recurring = ?, frequency = ?, notes = ?, next_due_date = ?,
         base_currency = ?, base_amount = ?, fx_rate = ?, fx_rate_source = ?, fx_rate_date = ?,
         business_use_pct = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ? AND user_id = ?`,
        [
          entityId,
          resolvedCategoryId,
          String(itemName).trim(),
          amountNum,
          editCurrency,
          purchaseDate,
          receiptPath,
          recurring ? 1 : 0,
          frequency || null,
          notes || null,
          nextDueDate,
          money.baseCurrency,
          money.baseAmount,
          money.rate,
          money.source,
          money.rateDate,
          businessUsePct,
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
      `SELECT e.receipt_path, e.item_name, e.purchase_date, c.name AS category_name, en.path_segment
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN entities en ON en.id = e.entity_id
       WHERE e.id = ? AND e.user_id = ?`,
      [req.params.id, req.user.id]
    );
    const row = rows[0];
    if (!row || !row.receipt_path) return res.status(404).json({ error: 'Receipt not found' });
    // The expense's own books, not whichever ones are selected — a receipt has
    // to open from the combined view too, where nothing is selected at all.
    const dir = dirFor(req.user.id, row.purchase_date, row.category_name || 'Uncategorised', req.user.financialYearRule, row.path_segment);
    const filePath = assertWithin(uploadsDir, path.join(dir, row.receipt_path));
    if (req.query.download) {
      const ext = path.extname(row.receipt_path);
      const safeName = row.item_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return res.download(filePath, `receipt-${safeName || 'expense'}${ext}`);
    }
    return serveAttachment(res, (await viewableCopy(uploadsDir, filePath)) || filePath, {
      originalName: row.receipt_path || row.original_name,
    });
  })
);

// Deleting an expense. It leaves the app immediately and there is nowhere to
// find it again — but the row is only marked, and `purgeExpiredTrash` removes
// it for good after 30 days. That window is invisible, costs nothing, and is
// the difference between "I deleted the wrong one" being a database query and
// being an apology.
//
// `deleteReceipt` additionally removes the file straight away rather than
// leaving it for the purge. The caller has to ask, because the file is the one
// part of this that genuinely cannot be brought back.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT e.id, e.entity_id, e.receipt_path, e.purchase_date, c.name AS category_name, en.path_segment
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN entities en ON en.id = e.entity_id
       WHERE e.id = ? AND e.user_id = ? AND e.deleted_at IS NULL`,
      [req.params.id, req.user.id]
    );
    const expense = rows[0];
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const closed = await blockIfFinalised(req.user, { entityId: expense.entity_id, dates: [expense.purchase_date] });
    if (closed) return res.status(409).json({ error: closed });

    const wanted = req.query.deleteReceipt === 'true' || req.body?.deleteReceipt === true;
    let receiptDeleted = false;

    if (wanted && expense.receipt_path) {
      const dir = dirFor(req.user.id, expense.purchase_date, expense.category_name || 'Uncategorised', req.user.financialYearRule, expense.path_segment);
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

export default router;
