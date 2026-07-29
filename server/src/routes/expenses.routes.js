import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { requireAuth, requireActiveAccess } from '../auth/middleware.js';
import { getVisibleUserIds } from '../auth/access.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { financialYearOf } from '../lib/financialYear.js';
import { advanceDate } from '../lib/recurrence.js';
import {
  receiptDirFor,
  inboxDirFor,
  assertWithin,
  isSafeFilename,
  isSafeFolderName,
  stagedFilename,
  toFolderSlug,
} from '../lib/receiptStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'application/pdf',
]);
const ALLOWED_RECEIPT_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.pdf']);

// iPhone photos often arrive with no useful MIME type — Windows and some
// browsers report .heic as application/octet-stream or an empty string — so
// fall back to the extension when the reported type isn't recognised.
function isAllowedUpload(file) {
  if (ALLOWED_MIME.has(file.mimetype)) return true;
  return ALLOWED_RECEIPT_EXT.has(path.extname(file.originalname).toLowerCase());
}

function dirFor(email, purchaseDate, categoryName) {
  return receiptDirFor(uploadsDir, email, purchaseDate, categoryName);
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
      const dir = dirFor(req.user.email, purchaseDate, categoryName);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file)) return cb(new Error('Unsupported file type'));
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Receipt inbox: a per-user staging folder for receipts uploaded in bulk before
// they're linked to an expense. Assigning one moves it out of the inbox and
// into the owning expense's <user>/<financial-year>/<category> folder.
// ---------------------------------------------------------------------------

function inboxFor(email, folder) {
  return inboxDirFor(uploadsDir, email, folder);
}

// Rejects anything that isn't a valid single-level folder, so a caller can't
// steer reads or writes outside the inbox. Returns null for "inbox root".
function safeFolderParam(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  return isSafeFolderName(raw) ? raw : undefined; // undefined signals invalid
}

// A folder-mode upload sends each file's path relative to the chosen folder
// (webkitRelativePath), so "Receipts/Tooling/img.png" is staged under
// "tooling". Deeper nesting collapses to its first segment — the inbox is one
// level deep by design.
function uploadFolderFor(req, file) {
  const explicit = req.body?.folder;
  if (explicit) return isSafeFolderName(explicit) ? explicit : null;

  const relative = file.originalname.includes('/') ? file.originalname : req.body?.relativePath;
  if (!relative) return null;
  const parts = String(relative).split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const slug = toFolderSlug(parts[parts.length - 2]);
  return isSafeFolderName(slug) ? slug : null;
}

const inboxUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dir = inboxFor(req.user.email, uploadFolderFor(req, file));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, assertWithin(uploadsDir, dir));
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) =>
      cb(null, stagedFilename(path.basename(file.originalname), crypto.randomBytes(3).toString('hex'))),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 200 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file)) return cb(new Error('Unsupported file type'));
    cb(null, true);
  },
});

// Once the last receipt leaves a staged folder, drop the folder too so the
// picker stops offering an empty group.
function pruneEmptyInboxFolder(email, folder) {
  if (!folder) return;
  try {
    const dir = assertWithin(uploadsDir, inboxFor(email, folder));
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // best effort — a non-empty or already-removed folder is fine
  }
}

// Moves a staged file into its destination folder, renaming on collision.
// Returns the filename actually stored, which is what goes in receipt_path.
function moveFromInbox(email, filename, destDir, folder) {
  const source = assertWithin(uploadsDir, path.join(inboxFor(email, folder), filename));
  if (!fs.existsSync(source)) return null;

  fs.mkdirSync(destDir, { recursive: true });
  let finalName = filename;
  let target = assertWithin(uploadsDir, path.join(destDir, finalName));
  if (fs.existsSync(target)) {
    const ext = path.extname(filename);
    finalName = `${path.basename(filename, ext)}-${crypto.randomBytes(3).toString('hex')}${ext}`;
    target = assertWithin(uploadsDir, path.join(destDir, finalName));
  }

  try {
    fs.renameSync(source, target);
  } catch (err) {
    // Different filesystems under uploads/ (e.g. a bind mount) make rename fail.
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
  pruneEmptyInboxFolder(email, folder);
  return finalName;
}

const TRASH_RETENTION_DAYS = 30;

export async function purgeExpiredTrash(dbPool) {
  const [rows] = await dbPool.execute(
    `SELECT e.id, e.receipt_path, e.purchase_date, u.email AS user_email, c.name AS category_name
     FROM expenses e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < DATE_SUB(NOW(), INTERVAL ${TRASH_RETENTION_DAYS} DAY)`
  );
  if (rows.length === 0) return;

  for (const row of rows) {
    if (row.receipt_path) {
      const dir = receiptDirFor(uploadsDir, row.user_email, row.purchase_date, row.category_name);
      fs.unlink(path.join(dir, row.receipt_path), () => {});
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
    const visibleUserIds = await getVisibleUserIds(req.user);
    const [rows] = await pool.execute(
      `SELECT e.id, e.item_name, e.amount, e.currency, e.purchase_date, e.receipt_path,
              e.is_recurring, e.frequency, e.notes, e.created_at, e.auto_generated,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.user_id IN (${visibleUserIds.map(() => '?').join(',')}) AND e.deleted_at IS NULL
       ORDER BY e.purchase_date DESC, e.id DESC`,
      visibleUserIds
    );

    const expenses = rows.map((r) => ({
      id: r.id,
      itemName: r.item_name,
      amount: Number(r.amount),
      currency: r.currency,
      purchaseDate: r.purchase_date,
      financialYear: financialYearOf(r.purchase_date),
      receiptUrl: r.receipt_path ? `/api/expenses/${r.id}/receipt` : null,
      receiptFilename: r.receipt_path || null,
      isRecurring: !!r.is_recurring,
      frequency: r.frequency,
      notes: r.notes,
      createdAt: r.created_at,
      autoGenerated: !!r.auto_generated,
      category: r.category_id
        ? { id: r.category_id, name: r.category_name, color: r.category_color, icon: r.category_icon }
        : null,
    }));

    res.json({ expenses });
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
        financialYear: financialYearOf(r.purchase_date),
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
      const { itemName, amount, currency, purchaseDate, categoryId, notes, isRecurring, frequency, receiptFilename, receiptSource, receiptFolder } = req.body || {};

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

      let newCategoryName = 'Uncategorised';
      if (categoryId) {
        const [categoryRows] = await pool.execute('SELECT id, name FROM categories WHERE id = ? AND user_id = ?', [
          categoryId,
          req.user.id,
        ]);
        if (categoryRows.length === 0) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid category' });
        }
        newCategoryName = categoryRows[0].name;
      }

      let receiptPath = req.file ? req.file.filename : null;
      if (!req.file && receiptFilename) {
        if (!isSafeFilename(receiptFilename)) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid receipt file' });
        }
        const dir = dirFor(req.user.email, purchaseDate, newCategoryName);
        if (receiptSource === 'inbox') {
          const folder = safeFolderParam(receiptFolder);
          if (folder === undefined) {
            cleanupUpload();
            return res.status(400).json({ error: 'Invalid receipt folder' });
          }
          const moved = moveFromInbox(req.user.email, receiptFilename, dir, folder);
          if (!moved) {
            cleanupUpload();
            return res.status(400).json({ error: 'Receipt file not found' });
          }
          receiptPath = moved;
        } else {
          let candidate;
          try {
            candidate = assertWithin(uploadsDir, path.join(dir, receiptFilename));
          } catch {
            cleanupUpload();
            return res.status(400).json({ error: 'Invalid receipt file' });
          }
          if (!fs.existsSync(candidate)) {
            cleanupUpload();
            return res.status(400).json({ error: 'Receipt file not found' });
          }
          receiptPath = receiptFilename;
        }
      }
      const recurring = isRecurring === 'true' || isRecurring === true;
      const nextDueDate = recurring ? advanceDate(purchaseDate, frequency) : null;

      const [result] = await pool.execute(
        `INSERT INTO expenses (user_id, category_id, item_name, amount, currency, purchase_date, receipt_path, is_recurring, frequency, notes, next_due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          categoryId || null,
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

      const { itemName, amount, currency, purchaseDate, categoryId, notes, isRecurring, frequency, removeReceipt, receiptFilename, receiptSource, receiptFolder } = req.body || {};

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

      let newCategoryName = 'Uncategorised';
      if (categoryId) {
        const [categoryRows] = await pool.execute('SELECT id, name FROM categories WHERE id = ? AND user_id = ?', [
          categoryId,
          req.user.id,
        ]);
        if (categoryRows.length === 0) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid category' });
        }
        newCategoryName = categoryRows[0].name;
      }

      const oldCategoryName = await categoryNameFor(req.user.id, existing.category_id);
      const oldDir = dirFor(req.user.email, existing.purchase_date, oldCategoryName);
      const newDir = dirFor(req.user.email, purchaseDate, newCategoryName);

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
      } else if (receiptFilename) {
        if (!isSafeFilename(receiptFilename)) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid receipt file' });
        }
        let resolvedName;
        if (receiptSource === 'inbox') {
          const folder = safeFolderParam(receiptFolder);
          if (folder === undefined) {
            cleanupUpload();
            return res.status(400).json({ error: 'Invalid receipt folder' });
          }
          const moved = moveFromInbox(req.user.email, receiptFilename, newDir, folder);
          if (!moved) {
            cleanupUpload();
            return res.status(400).json({ error: 'Receipt file not found' });
          }
          resolvedName = moved;
        } else {
          let candidate;
          try {
            candidate = assertWithin(uploadsDir, path.join(newDir, receiptFilename));
          } catch {
            cleanupUpload();
            return res.status(400).json({ error: 'Invalid receipt file' });
          }
          if (!fs.existsSync(candidate)) {
            cleanupUpload();
            return res.status(400).json({ error: 'Receipt file not found' });
          }
          resolvedName = receiptFilename;
        }
        if (existing.receipt_path && !(existing.receipt_path === resolvedName && oldDir === newDir)) {
          deleteOldAbsPath = path.join(oldDir, existing.receipt_path);
        }
        receiptPath = resolvedName;
      } else if (existing.receipt_path && oldDir !== newDir) {
        moveFrom = path.join(oldDir, existing.receipt_path);
        moveTo = path.join(newDir, existing.receipt_path);
      }

      const recurring = isRecurring === 'true' || isRecurring === true;
      const nextDueDate = recurring ? advanceDate(purchaseDate, frequency) : null;

      await pool.execute(
        `UPDATE expenses SET category_id = ?, item_name = ?, amount = ?, currency = ?, purchase_date = ?, receipt_path = ?, is_recurring = ?, frequency = ?, notes = ?, next_due_date = ?
         WHERE id = ? AND user_id = ?`,
        [
          categoryId || null,
          String(itemName).trim(),
          amountNum,
          currency || existing.currency || 'AUD',
          purchaseDate,
          receiptPath,
          recurring ? 1 : 0,
          frequency || null,
          notes || null,
          nextDueDate,
          req.params.id,
          req.user.id,
        ]
      );

      if (deleteOldAbsPath) {
        fs.unlink(deleteOldAbsPath, () => {});
      }
      if (moveFrom && moveTo) {
        fs.mkdirSync(newDir, { recursive: true });
        fs.rename(moveFrom, moveTo, (err) => {
          if (err) console.error('Failed to relocate receipt file', err);
        });
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
    const dir = dirFor(req.user.email, row.purchase_date, row.category_name || 'Uncategorised');
    const filePath = assertWithin(uploadsDir, path.join(dir, row.receipt_path));
    if (req.query.download) {
      const ext = path.extname(row.receipt_path);
      const safeName = row.item_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return res.download(filePath, `receipt-${safeName || 'expense'}${ext}`);
    }
    res.sendFile(filePath);
  })
);

router.get(
  '/receipts/browse',
  asyncHandler(async (req, res) => {
    const { categoryId, purchaseDate } = req.query;
    if (!purchaseDate) return res.status(400).json({ error: 'purchaseDate is required' });

    let categoryName = 'Uncategorised';
    if (categoryId) {
      const [rows] = await pool.execute('SELECT name FROM categories WHERE id = ? AND user_id = ?', [
        categoryId,
        req.user.id,
      ]);
      if (rows.length === 0) return res.status(400).json({ error: 'Invalid category' });
      categoryName = rows[0].name;
    }

    const dir = dirFor(req.user.email, purchaseDate, categoryName);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const filenames = entries
      .filter((e) => e.isFile() && ALLOWED_RECEIPT_EXT.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name);

    const assignedMap = new Map();
    if (filenames.length > 0) {
      const [rows] = await pool.execute(
        `SELECT id, item_name, receipt_path FROM expenses
         WHERE user_id = ? AND deleted_at IS NULL AND receipt_path IN (${filenames.map(() => '?').join(',')})`,
        [req.user.id, ...filenames]
      );
      for (const r of rows) assignedMap.set(r.receipt_path, { id: r.id, itemName: r.item_name });
    }

    const files = filenames.map((name) => {
      let stat = null;
      try {
        stat = fs.statSync(path.join(dir, name));
      } catch {
        stat = null;
      }
      const assignedTo = assignedMap.get(name) || null;
      return {
        filename: name,
        sizeBytes: stat ? stat.size : null,
        modifiedAt: stat ? stat.mtime : null,
        assigned: !!assignedTo,
        assignedTo,
      };
    });

    res.json({ files });
  })
);

router.get(
  '/receipts/file',
  asyncHandler(async (req, res) => {
    const { categoryId, purchaseDate, filename } = req.query;
    if (!purchaseDate || !filename) return res.status(400).json({ error: 'purchaseDate and filename are required' });
    if (!isSafeFilename(filename)) return res.status(400).json({ error: 'Invalid filename' });

    let categoryName = 'Uncategorised';
    if (categoryId) {
      const [rows] = await pool.execute('SELECT name FROM categories WHERE id = ? AND user_id = ?', [
        categoryId,
        req.user.id,
      ]);
      if (rows.length === 0) return res.status(400).json({ error: 'Invalid category' });
      categoryName = rows[0].name;
    }

    const dir = dirFor(req.user.email, purchaseDate, categoryName);
    let filePath;
    try {
      filePath = assertWithin(uploadsDir, path.join(dir, filename));
    } catch {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  })
);

// --- Receipt inbox -------------------------------------------------------

router.post(
  '/receipts/inbox',
  inboxUpload.array('receipts', 200),
  asyncHandler(async (req, res) => {
    const files = (req.files || []).map((f) => f.filename);
    if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
    res.status(201).json({ uploaded: files.length, files });
  })
);

// Lists the inbox root plus one level of subfolders. Each file carries the
// folder it lives in (null at the root) so the picker can group by it.
router.get(
  '/receipts/inbox',
  asyncHandler(async (req, res) => {
    const root = inboxFor(req.user.email);

    function readDir(dir, folder) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return { files: [], subdirs: [] };
      }
      const files = entries
        .filter(
          (e) =>
            e.isFile() &&
            ALLOWED_RECEIPT_EXT.has(path.extname(e.name).toLowerCase()) &&
            isSafeFilename(e.name)
        )
        .map((e) => {
          let stat = null;
          try {
            stat = fs.statSync(path.join(dir, e.name));
          } catch {
            stat = null;
          }
          return {
            filename: e.name,
            folder,
            sizeBytes: stat ? stat.size : null,
            modifiedAt: stat ? stat.mtime : null,
          };
        });
      const subdirs = entries.filter((e) => e.isDirectory() && isSafeFolderName(e.name)).map((e) => e.name);
      return { files, subdirs };
    }

    const { files: rootFiles, subdirs } = readDir(root, null);
    const all = [...rootFiles];
    const folders = [];
    for (const name of subdirs.sort()) {
      const { files } = readDir(path.join(root, name), name);
      if (files.length > 0) folders.push({ name, count: files.length });
      all.push(...files);
    }

    all.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
    res.json({ files: all, folders, rootCount: rootFiles.length });
  })
);

router.get(
  '/receipts/inbox/file',
  asyncHandler(async (req, res) => {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: 'filename is required' });
    if (!isSafeFilename(filename)) return res.status(400).json({ error: 'Invalid filename' });
    const folder = safeFolderParam(req.query.folder);
    if (folder === undefined) return res.status(400).json({ error: 'Invalid folder' });

    let filePath;
    try {
      filePath = assertWithin(uploadsDir, path.join(inboxFor(req.user.email, folder), filename));
    } catch {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  })
);

router.delete(
  '/receipts/inbox/:filename',
  asyncHandler(async (req, res) => {
    const { filename } = req.params;
    if (!isSafeFilename(filename)) return res.status(400).json({ error: 'Invalid filename' });
    const folder = safeFolderParam(req.query.folder);
    if (folder === undefined) return res.status(400).json({ error: 'Invalid folder' });

    let filePath;
    try {
      filePath = assertWithin(uploadsDir, path.join(inboxFor(req.user.email, folder), filename));
    } catch {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    pruneEmptyInboxFolder(req.user.email, folder);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT id FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Expense not found' });

    await pool.execute('UPDATE expenses SET deleted_at = NOW() WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT id FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Expense not found in recycle bin' });

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
      const dir = dirFor(req.user.email, row.purchase_date, row.category_name || 'Uncategorised');
      fs.unlink(path.join(dir, row.receipt_path), () => {});
    }
    res.json({ ok: true });
  })
);

export default router;
