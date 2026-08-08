import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { publicOrigin } from '../lib/publicOrigin.js';
import { notify, notifyAdmins } from '../lib/notify.js';
import { titleCase, lowerEmail } from '../lib/text.js';
import {
  SUPPORT_CATEGORIES,
  isCategory,
  categoryLabel,
  generateReference,
  generateAccessToken,
  hashAccessToken,
  statusAfterReply,
  canReply,
  messageProblem,
  subjectProblem,
} from '../lib/support.js';
import {
  sendSupportTicketRaisedEmail,
  sendSupportReplyEmail,
  sendSupportClosedEmail,
} from '../lib/mailer.js';

const router = Router();

// One shape, so the customer's page, the guest's page and the admin list cannot
// disagree about what a ticket looks like.
function shapeTicket(row, { includeEmail = false } = {}) {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    status: row.status,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    closedAt: row.closed_at,
    isGuest: !row.user_id,
    who: row.user_id ? row.name : row.guest_name,
    ...(includeEmail ? { email: row.user_id ? row.email : row.guest_email } : {}),
    avatarUrl: row.user_id && row.avatar_path ? `/api/auth/avatar/${row.user_id}` : null,
  };
}

function shapeMessage(row) {
  return {
    id: row.id,
    role: row.author_role,
    name: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    avatarUrl: row.author_user_id && row.avatar_path ? `/api/auth/avatar/${row.author_user_id}` : null,
  };
}

async function messagesFor(ticketId) {
  const [rows] = await pool.execute(
    `SELECT m.*, u.avatar_path FROM support_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.ticket_id = ? ORDER BY m.created_at ASC, m.id ASC`,
    [ticketId]
  );
  return rows.map(shapeMessage);
}

// Where a given ticket is read. A guest has no account to sign in to, so their
// link carries the token; everyone else opens it from inside the app.
function ticketUrl(ticket, token = null) {
  return token
    ? `${publicOrigin()}/support/ticket/${encodeURIComponent(token)}`
    : `${publicOrigin()}/support/${ticket.id}`;
}

// Telling whoever is now waiting. Never awaited by the caller for its own sake:
// a ticket that was raised has been raised, and failing the request because an
// email bounced would leave somebody retyping a message we already have.
async function announce(ticket, { body, fromSupport, isNew = false }) {
  const to = ticket.user_id ? ticket.email : ticket.guest_email;
  const name = ticket.user_id ? ticket.name : ticket.guest_name;
  const details = {
    reference: ticket.reference,
    subject: ticket.subject,
    category: categoryLabel(ticket.category),
    body,
    url: ticketUrl(ticket, ticket.guest_token || null),
  };

  try {
    if (isNew) {
      if (to) await sendSupportTicketRaisedEmail(to, name, details);
      await notifyAdmins({
        title: `New support ticket — ${categoryLabel(ticket.category)}`,
        body: `${name || 'Someone'}: ${ticket.subject}`,
        url: `/admin?tab=support`,
        kind: 'support',
      });
    } else if (fromSupport) {
      if (to) await sendSupportReplyEmail(to, name, { ...details, fromSupport: true });
      if (ticket.user_id) {
        await notify(ticket.user_id, {
          title: 'Support replied to your ticket',
          body: ticket.subject,
          url: `/support/${ticket.id}`,
          kind: 'support',
        });
      }
    } else {
      await notifyAdmins({
        title: `Reply on ${ticket.reference}`,
        body: `${name || 'A customer'}: ${ticket.subject}`,
        url: `/admin?tab=support`,
        kind: 'support',
      });
      // Support's own address, so a reply does not wait for somebody to open
      // the admin panel.
      const [admins] = await pool.query('SELECT email, name FROM users WHERE is_admin = 1');
      for (const admin of admins) {
        await sendSupportReplyEmail(admin.email, name, { ...details, fromSupport: false });
      }
    }
  } catch (err) {
    console.error('Support notification failed', err);
  }
}

// The categories, so the form is built from the same list the server validates
// against rather than a copy that can drift.
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    res.json({ categories: SUPPORT_CATEGORIES });
  })
);

// ---------------------------------------------------------------------------
// Raising a ticket. Open to anybody: somebody who cannot sign in is exactly who
// most needs to reach support.
// ---------------------------------------------------------------------------
router.post(
  '/tickets',
  // Signed in or not — both are allowed, and which one decides whether the
  // name and address are taken from the account or asked for.
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { subject, category, message } = req.body || {};

    const subjectIssue = subjectProblem(subject);
    if (subjectIssue) return res.status(400).json({ error: subjectIssue });
    if (!isCategory(category)) return res.status(400).json({ error: 'Choose what this is about' });
    const bodyIssue = messageProblem(message);
    if (bodyIssue) return res.status(400).json({ error: bodyIssue });

    // Signed in or not, decided here once.
    const user = req.user || null;
    let guestName = null;
    let guestEmail = null;
    let token = null;
    let tokenHash = null;

    if (!user) {
      guestName = titleCase(String(req.body?.name || '').trim()).slice(0, 120);
      guestEmail = lowerEmail(req.body?.email);
      if (!guestName) return res.status(400).json({ error: 'Tell us your name' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guestEmail)) {
        return res.status(400).json({ error: 'Enter an email address we can reply to' });
      }
      ({ token, tokenHash } = generateAccessToken());
    }

    // A collision is vanishingly unlikely, but a unique index turns one into a
    // 500 rather than a retry, and this is the first thing a customer ever does.
    let reference = generateReference();
    let ticketId = null;
    for (let attempt = 0; attempt < 3 && !ticketId; attempt += 1) {
      try {
        const [result] = await pool.execute(
          `INSERT INTO support_tickets
             (reference, user_id, guest_name, guest_email, category, subject, status, access_token_hash, last_message_at)
           VALUES (?, ?, ?, ?, ?, ?, 'awaiting_support', ?, NOW())`,
          [reference, user?.id || null, guestName, guestEmail, category, String(subject).trim(), tokenHash]
        );
        ticketId = result.insertId;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        reference = generateReference();
      }
    }
    if (!ticketId) return res.status(500).json({ error: 'Could not raise the ticket — please try again' });

    await pool.execute(
      `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
       VALUES (?, ?, 'customer', ?, ?)`,
      [ticketId, user?.id || null, user?.name || guestName, String(message).trim()]
    );

    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      [ticketId]
    );
    await announce({ ...rows[0], guest_token: token }, { body: String(message).trim(), isNew: true });

    res.json({
      ticket: shapeTicket(rows[0]),
      // Returned once and never again: it is only in the email after this.
      accessToken: token,
    });
  })
);

// ---------------------------------------------------------------------------
// Reading and replying, as the customer who owns it.
// ---------------------------------------------------------------------------
router.get(
  '/tickets',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email, u.avatar_path FROM support_tickets t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.user_id = ?
        ORDER BY FIELD(t.status, 'awaiting_customer', 'awaiting_support', 'closed'), t.last_message_at DESC`,
      [req.user.id]
    );
    res.json({ tickets: rows.map((r) => shapeTicket(r)) });
  })
);

router.get(
  '/tickets/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email, u.avatar_path FROM support_tickets t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.id = ? AND t.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ticket: shapeTicket(rows[0]), messages: await messagesFor(rows[0].id) });
  })
);

// ---------------------------------------------------------------------------
// The same, for a guest holding their emailed link.
// ---------------------------------------------------------------------------
router.get(
  '/ticket-by-token',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.access_token_hash = ?`,
      [hashAccessToken(req.query?.token || '')]
    );
    if (!rows[0]) return res.status(404).json({ error: 'invalid' });
    res.json({ ticket: shapeTicket(rows[0]), messages: await messagesFor(rows[0].id) });
  })
);

// One handler for both ways in, because the rules about replying are the same
// either way and writing them twice is how they end up different.
async function addReply(req, res, ticket, role) {
  const bodyIssue = messageProblem(req.body?.message);
  if (bodyIssue) return res.status(400).json({ error: bodyIssue });

  if (!canReply(ticket)) {
    return res.status(409).json({ error: 'This ticket is closed. Ask us to open it again if it is not sorted.' });
  }

  const name = role === 'support' ? req.user?.name || 'Support' : ticket.user_id ? ticket.name : ticket.guest_name;

  await pool.execute(
    `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
     VALUES (?, ?, ?, ?, ?)`,
    [ticket.id, req.user?.id || null, role, name, String(req.body.message).trim()]
  );

  const next = statusAfterReply(ticket.status, role);
  await pool.execute('UPDATE support_tickets SET status = ?, last_message_at = NOW(), updated_at = NOW() WHERE id = ?', [
    next,
    ticket.id,
  ]);

  await announce(ticket, { body: String(req.body.message).trim(), fromSupport: role === 'support' });

  res.json({ ok: true, status: next, messages: await messagesFor(ticket.id) });
}

router.post(
  '/tickets/:id/reply',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.id = ? AND t.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return addReply(req, res, rows[0], 'customer');
  })
);

router.post(
  '/reply-by-token',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.access_token_hash = ?`,
      [hashAccessToken(req.body?.token || '')]
    );
    if (!rows[0]) return res.status(404).json({ error: 'invalid' });
    // The token is the whole authority here, so it is carried back into the
    // notification rather than looked up again.
    return addReply(req, res, { ...rows[0], guest_token: req.body.token }, 'customer');
  })
);

export default router;
export { shapeTicket, messagesFor, addReply, announce, ticketUrl };
