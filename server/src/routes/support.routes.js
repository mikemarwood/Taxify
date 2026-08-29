import { Router } from 'express';
import { EMAIL_PATTERN } from '../lib/emailAddress.js';
import pool from '../db.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { publicOrigin, appOrigin } from '../lib/publicOrigin.js';
import { notify, notifyAdmins } from '../lib/notify.js';
import { titleCase, lowerEmail } from '../lib/text.js';
import { createCaptcha, verifyCaptcha } from '../lib/captcha.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serveAttachment } from '../lib/serveAttachment.js';
import { maskStaffMessage, supportDisplayName } from '../lib/supportIdentity.js';
import {
  ensureTicketDir,
  ticketDir,
  storedFilename,
  isAllowedAttachment,
  isInsideTicket,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  ATTACHMENT_REJECTED_MESSAGE,
} from '../lib/supportAttachments.js';
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
  replyProblem,
  subjectProblem,
} from '../lib/support.js';
import {
  sendSupportTicketRaisedEmail,
  sendSupportReplyEmail,
} from '../lib/mailer.js';

const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_MESSAGE },
  fileFilter: (req, file, cb) => {
    if (!isAllowedAttachment(file)) {
      return cb(Object.assign(new Error(ATTACHMENT_REJECTED_MESSAGE), { status: 400 }));
    }
    cb(null, true);
  },
});

// Writes what was uploaded and returns what to store on the message. The
// original filename is kept for display only — never for the path, because it
// is attacker-controlled text and only has to contain a slash once.
function saveAttachments(ticketId, messageId, files) {
  if (!files || files.length === 0) return null;
  const dir = ensureTicketDir(uploadsDir, ticketId);
  const saved = [];

  files.forEach((file, index) => {
    const name = storedFilename(messageId, index, file);
    fs.writeFileSync(path.join(dir, name), file.buffer);
    saved.push({
      file: name,
      name: String(file.originalname || 'image').slice(0, 160),
      bytes: file.size,
    });
  });

  return JSON.stringify(saved);
}

function parseAttachments(value) {
  if (!value) return [];
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// How many tickets one address may raise from one place before we stop
// listening. The captcha stops casual scripting; this stops one determined
// person sending a hundred emails through us, which is the part that costs
// somebody else their deliverability rather than just our time.
const GUEST_LIMIT = 5;
const GUEST_WINDOW_MS = 60 * 60 * 1000;
const guestAttempts = new Map();

function guestRateLimited(key, now = Date.now()) {
  const recent = (guestAttempts.get(key) || []).filter((at) => now - at < GUEST_WINDOW_MS);
  if (recent.length >= GUEST_LIMIT) {
    guestAttempts.set(key, recent);
    return true;
  }
  recent.push(now);
  guestAttempts.set(key, recent);

  // Bounded, so a long-running process cannot accumulate a key per address that
  // ever wrote in. Cleared wholesale rather than pruned: the window is an hour,
  // and losing it costs one person a few extra attempts.
  if (guestAttempts.size > 5000) guestAttempts.clear();
  return false;
}

const router = Router();

// One shape, so the customer's page, the guest's page and the admin list cannot
// disagree about what a ticket looks like.
// `staff` means this is going to the support side, which sees real names.
// Anything else is a customer's own view of their ticket, where the person
// holding it is named the same way their replies are — see supportIdentity.js.
//
// The default is the customer's view on purpose: a route added later that
// forgets to say who is asking gives away less rather than more.
function shapeTicket(row, { includeEmail = false, staff = false } = {}) {
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
    priority: row.priority || 'normal',
    assignedTo: row.assigned_to || null,
    // Not the operator's real name unless support is asking.
    //
    // It was sent to the customer's browser either way. Nothing rendered it,
    // so it never appeared on screen — but a full name sitting in a JSON
    // payload is a full name anybody who opens devtools has, and "it is not
    // displayed" is not the same as "it is not disclosed".
    assignedName: row.assigned_name ? (staff ? row.assigned_name : supportDisplayName()) : null,
  };
}

function shapeMessage(row, token = null) {
  return {
    id: row.id,
    role: row.author_role,
    name: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    // Shown in full rather than as a count. "Edited" on its own asks somebody
    // to take it on trust that nothing important changed.
    history: parseHistory(row.previous_bodies),
    attachments: parseAttachments(row.attachments).map((a, index) => ({
      name: a.name,
      bytes: a.bytes,
      // Served through a route that checks who is asking, never as a static
      // path — these are somebody's screenshots, often of their own tax records.
      // The token travels with the link for a guest: it is the only thing
      // proving they may see this, and without it their own images 404.
      url:
        `/api/support/attachments/${row.ticket_id}/${row.id}/${index}` +
        (token ? `?token=${encodeURIComponent(token)}` : ''),
    })),
    authorId: row.author_user_id || null,
    avatarUrl: row.author_user_id && row.avatar_path ? `/api/auth/avatar/${row.author_user_id}` : null,
  };
}

// The plan change a ticket is about, as the customer sees it.
//
// The invoice was raised inside their ticket and then only existed on the
// support side of it — so the thread said an invoice had been sent and gave
// them no way to open it, which is the one thing they wanted from the
// conversation. What they get is what they can act on: the amount, whether it
// is paid, and a link to pay it. Never who raised it, or what it cost us to
// decide.
export async function planRequestFor(ticket) {
  if (!ticket?.plan_change_request_id) return null;
  const [rows] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [
    ticket.plan_change_request_id,
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    toPlan: row.to_plan,
    fromPlan: row.from_plan,
    status: row.status,
    invoiceUrl: row.invoice_url,
    invoiceAmountCents: row.invoice_amount_cents,
    invoiceCurrency: row.invoice_currency,
    invoicedAt: row.invoiced_at,
    invoiceDueAt: row.invoice_due_at,
    paidAt: row.paid_at,
    voidedAt: row.voided_at,
  };
}

// `staff: true` means this thread is being read by support, who see everyone
// by name. Anything else is a customer reading their own conversation, and
// there the people answering are signed Support_Mike with the Taxify mark
// rather than by full name and photograph — see supportIdentity.js.
//
// The default is the customer's view, deliberately. A route added later that
// forgets to say who is asking hides too much rather than too little.
async function messagesFor(ticketId, { token = null, includeNotes = false, staff = false } = {}) {
  const [rows] = await pool.execute(
    `SELECT m.*, u.avatar_path FROM support_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.ticket_id = ? ORDER BY m.created_at ASC, m.id ASC`,
    [ticketId]
  );
  return rows
    // Internal notes are support talking to support. They are never sent to
    // the customer's side — filtered here rather than in each route, because a
    // route written later would not know to.
    .filter((row) => includeNotes || row.author_role !== 'note')
    .map((row) => {
      // Masked for everybody. Staff get the writer's real name added as a
      // second field rather than the label left alone, so both sides read the
      // same "Taxify Support" and only one of them sees who is behind it.
      const shaped = shapeMessage(row, token);
      return maskStaffMessage(shaped, { staff });
    });
}

// Where a given ticket is read. A guest has no account to sign in to, so their
// link carries the token; everyone else opens it from inside the app.
function ticketUrl(ticket, token = null) {
  return token
    ? `${appOrigin()}/support/ticket/${encodeURIComponent(token)}`
    : `${appOrigin()}/support/${ticket.id}`;
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
    // A guest can only be sent to their own token link, and only the hash of
    // that token is stored — so when support replies there is no way to rebuild
    // one. Sending them /support/<id> would land them on a page that needs an
    // account they do not have. The support page is the honest destination: it
    // asks them to use the link from their first email, which still works.
    url: ticket.user_id
      ? ticketUrl(ticket)
      : ticket.guest_token
      ? ticketUrl(ticket, ticket.guest_token)
      : `${appOrigin()}/support`,
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
    } else if (ticket.assigned_to) {
      // Somebody is dealing with this one, so it is their reply to read.
      await notify(ticket.assigned_to, {
        title: `Reply on ${ticket.reference}`,
        body: `${name || 'A customer'}: ${ticket.subject}`,
        url: '/admin?tab=support',
        kind: 'support',
      });
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


// An attachment, served only to somebody who can already read the thread it
// belongs to. Never a static path: these are people's screenshots, often of
// their own tax records, and a guessable URL under /uploads would be readable
// by anyone who guessed it.
router.get(
  '/attachments/:ticketId/:messageId/:index',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT m.attachments, t.id AS ticket_id, t.user_id, t.access_token_hash
         FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id
        WHERE m.id = ? AND m.ticket_id = ?`,
      [req.params.messageId, req.params.ticketId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });

    // Three ways to be allowed, and no fourth: an administrator, the account
    // the ticket belongs to, or somebody holding the guest link for it.
    const isAdmin = Boolean(req.user?.isAdmin);
    const isOwner = row.user_id && req.user?.id === row.user_id;
    const token = req.query?.token ? hashAccessToken(req.query.token) : null;
    const hasLink = row.access_token_hash && token && row.access_token_hash === token;
    if (!isAdmin && !isOwner && !hasLink) return res.status(404).json({ error: 'Not found' });

    const list = parseAttachments(row.attachments);
    const item = list[Number(req.params.index)];
    if (!item) return res.status(404).json({ error: 'Not found' });

    const filePath = path.join(ticketDir(uploadsDir, row.ticket_id), item.file);
    // The stored path is only as trustworthy as whatever wrote it, so where it
    // actually points is checked rather than assumed.
    if (!isInsideTicket(uploadsDir, row.ticket_id, filePath) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    // ?download=1 asks for the copy that saves rather than the one that
    // displays; without it the Download button would just show the image again.
    return serveAttachment(res, filePath, {
      originalName: item.name,
      download: req.query?.download === '1',
    });
  })
);

router.patch(
  '/tickets/:ticketId/messages/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT m.*, t.status, t.id AS ticket_id FROM support_messages m
         JOIN support_tickets t ON t.id = m.ticket_id
        WHERE m.id = ? AND m.ticket_id = ? AND t.user_id = ?`,
      [req.params.id, req.params.ticketId, req.user.id]
    );
    const row = rows[0];
    // Your own message only. Somebody editing support's replies into their own
    // thread would be rewriting the answer as well as the question.
    if (!row || row.author_user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    return editMessage(req, res, row, { id: row.ticket_id, status: row.status });
  })
);

// The same, for a guest holding their link.
router.patch(
  '/messages-by-token',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT m.*, t.status, t.id AS ticket_id FROM support_messages m
         JOIN support_tickets t ON t.id = m.ticket_id
        WHERE m.id = ? AND t.access_token_hash = ?`,
      [req.body?.messageId, hashAccessToken(req.body?.token || '')]
    );
    const row = rows[0];
    // A guest wrote it if nobody signed in did. The link proves the ticket;
    // author_role proves the side.
    if (!row || row.author_role !== 'customer' || row.author_user_id !== null) {
      return res.status(404).json({ error: 'Not found' });
    }
    return editMessage(req, res, row, { id: row.ticket_id, status: row.status });
  })
);

// The numbers behind the badges in the navigation. One call, because the
// sidebar asks for both and three separate polls would be three times the work
// for the same answer.
// The sum a guest has to answer. Only guests are asked: somebody already
// signed in has proved they are a person, and asking again is friction for no
// gain.
router.get(
  '/captcha',
  asyncHandler(async (req, res) => {
    res.json(createCaptcha());
  })
);

router.get(
  '/counts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [mine] = await pool.execute(
      `SELECT COUNT(*) AS n FROM support_tickets
        WHERE user_id = ? AND status = 'awaiting_customer'
          AND (customer_read_at IS NULL OR customer_read_at < last_message_at)`,
      [req.user.id]
    );

    // Only an administrator is told about the queue, and only they are asked
    // for it — a customer has no business knowing how much support is behind.
    let needingReply = 0;
    if (req.user.isAdmin) {
      const [queue] = await pool.execute(
        `SELECT COUNT(*) AS n FROM support_tickets
          WHERE status = 'awaiting_support'
            AND (support_read_at IS NULL OR support_read_at < last_message_at)
            AND (assigned_to IS NULL OR assigned_to = ?)`
        ,
        [req.user.id]
      );
      needingReply = Number(queue[0]?.n) || 0;
    }

    res.json({ waitingOnYou: Number(mine[0]?.n) || 0, needingReply });
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
  upload.array('attachments', MAX_ATTACHMENTS_PER_MESSAGE),
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
      if (!EMAIL_PATTERN.test(guestEmail)) {
        return res.status(400).json({ error: 'Enter an email address we can reply to' });
      }
      // Checked before anything is written. An unauthenticated endpoint that
      // emails somebody on demand is exactly what gets found and abused.
      if (!verifyCaptcha(req.body?.captchaToken, req.body?.captchaAnswer)) {
        return res.status(400).json({ error: 'That answer was not right — try the new sum' });
      }

      if (guestRateLimited(`${req.ip}|${guestEmail}`)) {
        return res.status(429).json({
          error: 'That is a lot of requests in a short time. Please wait a while, or reply to one you already sent.',
        });
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

    const [firstMessage] = await pool.execute(
      `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
       VALUES (?, ?, 'customer', ?, ?)`,
      [ticketId, user?.id || null, user?.name || guestName, String(message).trim()]
    );

    // Written after the insert, because the folder is named after the ticket
    // and the file after the message — neither id exists before this point.
    const attached = saveAttachments(ticketId, firstMessage.insertId, req.files);
    if (attached) {
      await pool.execute('UPDATE support_messages SET attachments = ? WHERE id = ?', [
        attached,
        firstMessage.insertId,
      ]);
    }

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

    // Opening it is reading it. Without this the badge keeps counting a ticket
    // somebody has already looked at, and a number that will not clear is one
    // people stop believing.
    await pool.execute('UPDATE support_tickets SET customer_read_at = NOW() WHERE id = ?', [rows[0].id]);

    res.json({
      ticket: shapeTicket(rows[0]),
      messages: await messagesFor(rows[0].id),
      planRequest: await planRequestFor(rows[0]),
    });
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
    await pool.execute('UPDATE support_tickets SET customer_read_at = NOW() WHERE id = ?', [rows[0].id]);
    res.json({
      ticket: shapeTicket(rows[0]),
      messages: await messagesFor(rows[0].id, { token: req.query.token }),
      planRequest: await planRequestFor(rows[0]),
    });
  })
);


// Editing a message somebody already sent.
//
// One handler for all three ways in, because the rules are the same however you
// arrived and writing them out three times is how they end up different.
//
// What is *not* allowed matters as much as what is: only your own message, only
// while the ticket is open, and never the attachments. A closed ticket is a
// finished record, and letting somebody rewrite what they said after it was
// answered would make the whole thread unreliable as evidence of itself.
async function editMessage(req, res, message, ticket, { includeNotes = false } = {}) {
  const problem =
    message.author_role === 'note'
      ? String(req.body?.message ?? '').trim()
        ? ''
        : 'Write the note first'
      : replyProblem(req.body?.message);
  if (problem) return res.status(400).json({ error: problem });

  if (ticket.status === 'closed') {
    return res.status(409).json({ error: 'This conversation is closed, so it can no longer be edited.' });
  }

  const next = String(req.body.message).trim();
  if (next === message.body) return res.json({ ok: true, messages: await messagesFor(ticket.id, { includeNotes }) });

  // The old text is kept, oldest first. Nothing is ever removed from this —
  // the point of a history is that it cannot be edited either.
  const history = parseHistory(message.previous_bodies);
  history.push({ body: message.body, at: new Date().toISOString() });

  await pool.execute(
    'UPDATE support_messages SET body = ?, previous_bodies = ?, edited_at = NOW() WHERE id = ?',
    [next, JSON.stringify(history.slice(-20)), message.id]
  );

  res.json({ ok: true, messages: await messagesFor(ticket.id, { includeNotes }) });
}

function parseHistory(value) {
  if (!value) return [];
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// One handler for both ways in, because the rules about replying are the same
// either way and writing them twice is how they end up different.
async function addReply(req, res, ticket, role, token = null) {
  // The reply rule, not the first-message one — a thread already carries the
  // question, so "Yes" and "Tuesday works" are complete answers.
  const bodyIssue = replyProblem(req.body?.message);
  if (bodyIssue) return res.status(400).json({ error: bodyIssue });

  if (!canReply(ticket)) {
    return res.status(409).json({ error: 'This ticket is closed. Raise a new one if you still need help.' });
  }

  const name = role === 'support' ? req.user?.name || 'Support' : ticket.user_id ? ticket.name : ticket.guest_name;

  const [inserted] = await pool.execute(
    `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
     VALUES (?, ?, ?, ?, ?)`,
    [ticket.id, req.user?.id || null, role, name, String(req.body.message).trim()]
  );

  const attached = saveAttachments(ticket.id, inserted.insertId, req.files);
  if (attached) {
    await pool.execute('UPDATE support_messages SET attachments = ? WHERE id = ?', [attached, inserted.insertId]);
  }

  const next = statusAfterReply(ticket.status, role);
  const readColumn = role === 'support' ? 'support_read_at' : 'customer_read_at';
  await pool.execute(
    `UPDATE support_tickets SET status = ?, last_message_at = NOW(), updated_at = NOW(),
       ${readColumn} = NOW() WHERE id = ?`,
    [next, ticket.id]
  );

  await announce(ticket, { body: String(req.body.message).trim(), fromSupport: role === 'support' });

  res.json({
    ok: true,
    status: next,
    messages: await messagesFor(ticket.id, { token, includeNotes: role === 'support' }),
  });
}

router.post(
  '/tickets/:id/reply',
  requireAuth,
  upload.array('attachments', MAX_ATTACHMENTS_PER_MESSAGE),
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
  upload.array('attachments', MAX_ATTACHMENTS_PER_MESSAGE),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.access_token_hash = ?`,
      [hashAccessToken(req.body?.token || '')]
    );
    if (!rows[0]) return res.status(404).json({ error: 'invalid' });
    // The token is the whole authority here, so it is carried back into the
    // notification rather than looked up again.
    return addReply(req, res, { ...rows[0], guest_token: req.body.token }, 'customer', req.body.token);
  })
);

export default router;
export { shapeTicket, messagesFor, addReply, announce, ticketUrl, upload, saveAttachments, editMessage };
