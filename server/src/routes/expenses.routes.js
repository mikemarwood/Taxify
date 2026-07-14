import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { financialYearOf } from '../lib/financialYear.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

function userReceiptsDir(userId) {
  return path.join(uploadsDir, String(userId));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = userReceiptsDir(req.user.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
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
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Unsupported file type'));
    cb(null, true);
  },
});

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT e.id, e.item_name, e.amount, e.currency, e.purchase_date, e.receipt_path,
              e.is_recurring, e.frequency, e.notes, e.created_at,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = ?
       ORDER BY e.purchase_date DESC, e.id DESC`,
      [req.user.id]
    );

    const expenses = rows.map((r) => ({
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
      category: r.category_id
        ? { id: r.category_id, name: r.category_name, color: r.category_color, icon: r.category_icon }
        : null,
    }));

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

      if (categoryId) {
        const [categoryRows] = await pool.execute('SELECT id FROM categories WHERE id = ? AND user_id = ?', [
          categoryId,
          req.user.id,
        ]);
        if (categoryRows.length === 0) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid category' });
        }
      }

      const receiptPath = req.file ? req.file.filename : null;

      const [result] = await pool.execute(
        `INSERT INTO expenses (user_id, category_id, item_name, amount, currency, purchase_date, receipt_path, is_recurring, frequency, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          categoryId || null,
          String(itemName).trim(),
          amountNum,
          currency || 'AUD',
          purchaseDate,
          receiptPath,
          isRecurring === 'true' || isRecurring === true ? 1 : 0,
          frequency || null,
          notes || null,
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

      if (categoryId) {
        const [categoryRows] = await pool.execute('SELECT id FROM categories WHERE id = ? AND user_id = ?', [
          categoryId,
          req.user.id,
        ]);
        if (categoryRows.length === 0) {
          cleanupUpload();
          return res.status(400).json({ error: 'Invalid category' });
        }
      }

      let receiptPath = existing.receipt_path;
      let oldReceiptToDelete = null;
      if (req.file) {
        if (existing.receipt_path) oldReceiptToDelete = existing.receipt_path;
        receiptPath = req.file.filename;
      } else if (removeReceipt === 'true' || removeReceipt === true) {
        if (existing.receipt_path) oldReceiptToDelete = existing.receipt_path;
        receiptPath = null;
      }

      await pool.execute(
        `UPDATE expenses SET category_id = ?, item_name = ?, amount = ?, currency = ?, purchase_date = ?, receipt_path = ?, is_recurring = ?, frequency = ?, notes = ?
         WHERE id = ? AND user_id = ?`,
        [
          categoryId || null,
          String(itemName).trim(),
          amountNum,
          currency || existing.currency || 'AUD',
          purchaseDate,
          receiptPath,
          isRecurring === 'true' || isRecurring === true ? 1 : 0,
          frequency || null,
          notes || null,
          req.params.id,
          req.user.id,
        ]
      );

      if (oldReceiptToDelete) {
        fs.unlink(path.join(userReceiptsDir(req.user.id), oldReceiptToDelete), () => {});
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
    const [rows] = await pool.execute('SELECT receipt_path FROM expenses WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    const row = rows[0];
    if (!row || !row.receipt_path) return res.status(404).json({ error: 'Receipt not found' });
    res.sendFile(path.join(userReceiptsDir(req.user.id), row.receipt_path));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT receipt_path FROM expenses WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Expense not found' });

    await pool.execute('DELETE FROM expenses WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (row.receipt_path) {
      const filePath = path.join(userReceiptsDir(req.user.id), row.receipt_path);
      fs.unlink(filePath, () => {});
    }
    res.json({ ok: true });
  })
);

export default router;
