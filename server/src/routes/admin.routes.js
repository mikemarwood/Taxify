import { Router } from 'express';
import pool, { getSetting, setSetting } from '../db.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toTitleCase } from '../lib/text.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const PALETTE = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#a1a1aa', '#ef4444', '#eab308', '#14b8a6'];

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.is_admin, u.avatar_path, u.created_at,
              (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id) AS expense_count
       FROM users u
       ORDER BY u.created_at`
    );
    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isAdmin: !!u.is_admin,
        avatarUrl: u.avatar_path ? `/api/auth/avatar/${u.id}` : null,
        createdAt: u.created_at,
        expenseCount: u.expense_count,
      })),
    });
  })
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    const { isAdmin } = req.body || {};
    if (typeof isAdmin !== 'boolean') return res.status(400).json({ error: 'isAdmin must be a boolean' });

    if (targetId === req.user.id) {
      return res.status(400).json({ error: "You can't change your own admin status" });
    }

    const [result] = await pool.execute('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin ? 1 : 0, targetId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  })
);

router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: "You can't delete your own account" });

    const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [targetId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  })
);

router.get(
  '/default-categories',
  asyncHandler(async (req, res) => {
    const [categories] = await pool.execute('SELECT id, name, color, icon FROM default_categories ORDER BY name');
    res.json({ categories });
  })
);

router.post(
  '/default-categories',
  asyncHandler(async (req, res) => {
    const { name, color, icon } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Category name is required' });

    const finalColor = color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
    try {
      const [result] = await pool.execute(
        'INSERT INTO default_categories (name, color, icon) VALUES (?, ?, ?)',
        [toTitleCase(String(name).trim()), finalColor, icon || 'tag']
      );
      const [rows] = await pool.execute('SELECT id, name, color, icon FROM default_categories WHERE id = ?', [result.insertId]);
      res.status(201).json({ category: rows[0] });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'A default category with that name already exists' });
      }
      throw err;
    }
  })
);

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const registrationEnabled = await getSetting('registration_enabled');
    res.json({ registrationEnabled: registrationEnabled !== 'false' });
  })
);

router.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const { registrationEnabled } = req.body || {};
    if (typeof registrationEnabled !== 'boolean') {
      return res.status(400).json({ error: 'registrationEnabled must be a boolean' });
    }
    await setSetting('registration_enabled', registrationEnabled ? 'true' : 'false');
    res.json({ ok: true });
  })
);

router.delete(
  '/default-categories/:id',
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM default_categories WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Default category not found' });
    res.json({ ok: true });
  })
);

export default router;
