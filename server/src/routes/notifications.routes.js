import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isPushConfigured } from '../lib/notify.js';

const router = Router();
router.use(requireAuth);

// Notifications belong to the login that reads them, not to the account — an
// accountant's "your access expires tomorrow" is theirs, not their client's.

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, title, body, url, kind, read_at, created_at FROM notifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`,
      [req.user.id]
    );
    const [[counts]] = await pool.execute(
      'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );

    res.json({
      unread: Number(counts?.unread) || 0,
      pushEnabled: await isPushConfigured(),
      notifications: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body || '',
        url: n.url,
        kind: n.kind,
        read: !!n.read_at,
        createdAt: n.created_at,
      })),
    });
  })
);

router.post(
  '/read',
  asyncHandler(async (req, res) => {
    const id = Number(req.body?.id);
    // No id means "I've seen all of them", which is what closing the panel says.
    if (Number.isInteger(id)) {
      await pool.execute('UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ?', [id, req.user.id]);
    } else {
      await pool.execute('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [
        req.user.id,
      ]);
    }
    res.json({ ok: true });
  })
);

// Clearing the list.
//
// Marking everything read empties the badge but leaves the panel full, so a
// list somebody has finished with keeps growing and stops being worth opening.
// This removes them — their own, and only theirs.
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM notifications WHERE user_id = ?', [req.user.id]);
    res.json({ ok: true, cleared: result.affectedRows || 0 });
  })
);

// The Android app hands over its Firebase token so pushes can reach it. Keyed
// on the token: the same person may have two devices, and Android reissues a
// token whenever it feels like it.
router.post(
  '/devices',
  asyncHandler(async (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (token.length < 20 || token.length > 255) return res.status(400).json({ error: 'Invalid device token' });

    await pool.execute(
      `INSERT INTO device_tokens (token, user_id, platform, last_seen_at) VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), last_seen_at = NOW()`,
      [token, req.user.id, String(req.body?.platform || 'android').slice(0, 20)]
    );
    res.json({ ok: true });
  })
);

router.delete(
  '/devices/:token',
  asyncHandler(async (req, res) => {
    await pool.execute('DELETE FROM device_tokens WHERE token = ? AND user_id = ?', [req.params.token, req.user.id]);
    res.json({ ok: true });
  })
);

export default router;
