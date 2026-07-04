import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { financialYearOf } from '../lib/financialYear.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.user.id}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Unsupported file type'));
    cb(null, true);
  },
});

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.id, e.item_name, e.amount, e.currency, e.purchase_date, e.receipt_path,
              e.is_recurring, e.frequency, e.notes, e.created_at,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = ?
       ORDER BY e.purchase_date DESC, e.id DESC`
    )
    .all(req.user.id);

  const expenses = rows.map((r) => ({
    id: r.id,
    itemName: r.item_name,
    amount: r.amount,
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
});

router.post('/', upload.single('receipt'), (req, res) => {
  const { itemName, amount, currency, purchaseDate, categoryId, notes, isRecurring, frequency } = req.body || {};

  if (!itemName || !String(itemName).trim()) return res.status(400).json({ error: 'Item name is required' });
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'A valid amount is required' });
  if (!purchaseDate) return res.status(400).json({ error: 'Purchase date is required' });

  if (categoryId) {
    const category = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(categoryId, req.user.id);
    if (!category) return res.status(400).json({ error: 'Invalid category' });
  }

  const receiptPath = req.file ? req.file.filename : null;

  const info = db
    .prepare(
      `INSERT INTO expenses (user_id, category_id, item_name, amount, currency, purchase_date, receipt_path, is_recurring, frequency, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      categoryId || null,
      String(itemName).trim(),
      amountNum,
      currency || 'AUD',
      purchaseDate,
      receiptPath,
      isRecurring === 'true' || isRecurring === true ? 1 : 0,
      frequency || null,
      notes || null
    );

  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/:id/receipt', (req, res) => {
  const row = db
    .prepare('SELECT receipt_path FROM expenses WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row || !row.receipt_path) return res.status(404).json({ error: 'Receipt not found' });
  res.sendFile(path.join(uploadsDir, row.receipt_path));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT receipt_path FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Expense not found' });

  db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (row.receipt_path) {
    const filePath = path.join(uploadsDir, row.receipt_path);
    fs.unlink(filePath, () => {});
  }
  res.json({ ok: true });
});

export default router;
