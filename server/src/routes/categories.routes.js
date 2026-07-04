import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth);

const PALETTE = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#a1a1aa', '#ef4444', '#eab308', '#14b8a6'];

router.get('/', (req, res) => {
  const categories = db
    .prepare('SELECT id, name, color, icon FROM categories WHERE user_id = ? ORDER BY name')
    .all(req.user.id);
  res.json({ categories });
});

router.post('/', (req, res) => {
  const { name, color, icon } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Category name is required' });

  const finalColor = color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  try {
    const info = db
      .prepare('INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)')
      .run(req.user.id, String(name).trim(), finalColor, icon || 'tag');
    const category = db.prepare('SELECT id, name, color, icon FROM categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ category });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A category with that name already exists' });
    }
    throw err;
  }
});

router.delete('/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

export default router;
