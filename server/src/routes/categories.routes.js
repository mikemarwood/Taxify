import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toTitleCase } from '../lib/text.js';

const router = Router();
router.use(requireAuth);

const PALETTE = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#a1a1aa', '#ef4444', '#eab308', '#14b8a6'];

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 40;

function validateName(name) {
  if (!name || !String(name).trim()) return 'Category name is required';
  const trimmed = String(name).trim();
  if (trimmed.length < MIN_NAME_LENGTH) return `Category name must be at least ${MIN_NAME_LENGTH} characters`;
  if (trimmed.length > MAX_NAME_LENGTH) return `Category name must be ${MAX_NAME_LENGTH} characters or fewer`;
  return null;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [categories] = await pool.execute(
      'SELECT id, name, color, icon FROM categories WHERE user_id = ? ORDER BY name',
      [req.user.id]
    );
    res.json({ categories });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, color, icon } = req.body || {};
    const nameError = validateName(name);
    if (nameError) return res.status(400).json({ error: nameError });

    const finalColor = color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
    try {
      const [result] = await pool.execute(
        'INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)',
        [req.user.id, toTitleCase(String(name).trim()), finalColor, icon || 'tag']
      );
      const [rows] = await pool.execute('SELECT id, name, color, icon FROM categories WHERE id = ?', [result.insertId]);
      res.status(201).json({ category: rows[0] });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'A category with that name already exists' });
      }
      throw err;
    }
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name, color, icon } = req.body || {};

    const [existingRows] = await pool.execute('SELECT id, name, color, icon FROM categories WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    let finalName = existing.name;
    if (name !== undefined) {
      const nameError = validateName(name);
      if (nameError) return res.status(400).json({ error: nameError });
      finalName = toTitleCase(String(name).trim());
    }
    const finalColor = color || existing.color;
    const finalIcon = icon || existing.icon;

    try {
      await pool.execute('UPDATE categories SET name = ?, color = ?, icon = ? WHERE id = ? AND user_id = ?', [
        finalName,
        finalColor,
        finalIcon,
        req.params.id,
        req.user.id,
      ]);
      const [rows] = await pool.execute('SELECT id, name, color, icon FROM categories WHERE id = ?', [req.params.id]);
      res.json({ category: rows[0] });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'A category with that name already exists' });
      }
      throw err;
    }
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [[{ count }]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM expenses WHERE category_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (count > 0) {
      return res.status(400).json({
        error: `Cannot delete a category that still has ${count} expense${count === 1 ? '' : 's'} — move or delete them first.`,
      });
    }

    const [result] = await pool.execute('DELETE FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ ok: true });
  })
);

export default router;
