import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireAdmin, requireSupportStaff } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { publicOrigin, appOrigin } from '../lib/publicOrigin.js';
import { notify } from '../lib/notify.js';
import { categoryLabel, isPriority, PRIORITIES } from '../lib/support.js';
import { sendSupportClosedEmail } from '../lib/mailer.js';
import { getSignupPlans } from '../lib/stripe.js';
import {
  shapeTicket,
  messagesFor,
  addReply,
  ticketUrl,
  upload,
  editMessage,
  announce,
  saveAttachments,
} from './support.routes.js';
import {
  generateReference,
  generateAccessToken,
  isCategory,
  isPriority as isPriorityValue,
  subjectProblem,
  messageProblem,
} from '../lib/support.js';
import { removeTicketFiles, MAX_ATTACHMENTS_PER_MESSAGE } from '../lib/supportAttachments.js';
import path from 'path';
import { fileURLToPath } from 'url';

const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

// The support queue, kept out of admin.routes.js on purpose.
//
// That file opens with `router.use(requireAuth, requireAdmin)`, which runs
// before every route in it. Per-route requireSupportStaff guards sat behind that
// and never ran, so a support-only account was refused by requireAdmin first and
// got 403 on the whole queue — the support flag granted nothing to anybody who
// was not already an administrator.
//
// Fixing it by loosening the blanket guard would have been the wrong repair. It
// is what makes every other admin route safe by default rather than by somebody
// remembering, and it should stay exactly as strict as it is. So the one
// deliberate exception lives here instead, where the exception is stated once
// and is impossible to grant by accident.
const router = Router();
router.use(requireAuth, requireSupportStaff);

// ---------------------------------------------------------------------------
// Support tickets, from the other side of the conversation.
// ---------------------------------------------------------------------------

router.get(
  '/support/tickets',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    // Anything needing a reply first, oldest first within that — somebody who
    // has been waiting two days should not sit below somebody who wrote in five
    // minutes ago.
    // Built as fragments with their own parameters. Interpolating any of this
    // into the SQL would be the one place in the file where somebody's typing
    // reaches the query.
    const where = [];
    const params = [];

    const search = String(req.query?.q || '').trim().slice(0, 80);
    if (search) {
      where.push('(t.reference LIKE ? OR t.subject LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR t.guest_name LIKE ? OR t.guest_email LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like);
    }

    const status = String(req.query?.status || '').trim();
    if (['awaiting_support', 'awaiting_customer', 'closed'].includes(status)) {
      where.push('t.status = ?');
      params.push(status);
    }

    if (String(req.query?.mine || '') === '1') {
      where.push('t.assigned_to = ?');
      params.push(req.user.id);
    }
    if (String(req.query?.unassigned || '') === '1') where.push('t.assigned_to IS NULL');

    const category = String(req.query?.category || '').trim();
    if (category) {
      where.push('t.category = ?');
      params.push(category);
    }

    // A page rather than a limit. The old 200 was a silent truncation: no way
    // to reach 201, and nothing on screen saying it had stopped.
    const perPage = 40;
    const page = Math.max(1, Math.min(999, Number(req.query?.page) || 1));

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[counted]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ${clause}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email, u.avatar_path,
              a.name AS assigned_name
         FROM support_tickets t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assigned_to
        ${clause}
        ORDER BY FIELD(t.status, 'awaiting_support', 'awaiting_customer', 'closed'),
                 FIELD(t.priority, 'urgent', 'high', 'normal', 'low'),
                 t.last_message_at ASC
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      params
    );
    const [states] = await pool.execute(
      `SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status`
    );
    const [byCategory] = await pool.execute(
      `SELECT category, COUNT(*) AS n FROM support_tickets
        WHERE status <> 'closed' GROUP BY category`
    );
    const [[mine]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM support_tickets WHERE assigned_to = ? AND status <> 'closed'`,
      [req.user.id]
    );
    const [[unassigned]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM support_tickets WHERE assigned_to IS NULL AND status <> 'closed'`
    );
    // Closed in the last seven days. A running total of everything ever closed
    // only goes up and says nothing about how this week is going.
    const [[closedRecently]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM support_tickets
        WHERE status = 'closed' AND closed_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    const state = Object.fromEntries(states.map((row) => [row.status, Number(row.n) || 0]));

    res.json({
      tickets: rows.map((r) => shapeTicket(r, { includeEmail: true })),
      total: Number(counted.n) || 0,
      page,
      perPage,
      summary: {
        awaitingSupport: state.awaiting_support || 0,
        awaitingCustomer: state.awaiting_customer || 0,
        mine: Number(mine.n) || 0,
        unassigned: Number(unassigned.n) || 0,
        closedThisWeek: Number(closedRecently.n) || 0,
        // Open tickets per category, so the chips can carry a number and the
        // busiest kind of question is visible without opening any of them.
        categories: Object.fromEntries(byCategory.map((row) => [row.category, Number(row.n) || 0])),
      },
    });
  })
);

router.get(
  '/support/tickets/:id',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      // The assignee joined here as well as in the list above.
      //
      // It was not, so assigned_name came back undefined and the panel above
      // the conversation read "null is dealing with this" the moment a ticket
      // was handed to somebody. The list beside it showed the right name from
      // the same column, which is what made it look like the handover had
      // failed rather than the query.
      `SELECT t.*, u.name, u.email, u.avatar_path, a.name AS assigned_name
         FROM support_tickets t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assigned_to
        WHERE t.id = ?`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    // Opening it counts as reading it, which is what takes it off the badge.
    // The status is untouched: it still needs a reply, and only replying
    // changes that.
    await pool.execute('UPDATE support_tickets SET support_read_at = NOW() WHERE id = ?', [rows[0].id]);

    // Who is asking. A guest has no account behind them, so this is null and
    // the panel says so rather than showing a row of dashes.
    let customer = null;
    if (rows[0].user_id) {
      const [who] = await pool.execute(
        `SELECT u.id, u.plan_type, u.subscription_status, u.trial_ends_at, u.created_at, u.country,
                u.account_number,
                (SELECT COUNT(*) FROM support_tickets s WHERE s.user_id = u.id) AS ticket_count
           FROM users u WHERE u.id = ?`,
        [rows[0].user_id]
      );
      if (who[0]) {
        customer = {
          id: who[0].id,
          accountNumber: who[0].account_number || null,
          planType: who[0].plan_type || null,
          subscriptionStatus: who[0].subscription_status || null,
          trialEndsAt: who[0].trial_ends_at,
          joinedAt: who[0].created_at,
          country: who[0].country || null,
          ticketCount: Number(who[0].ticket_count) || 0,
        };
      }
    }

    // The plan change this ticket is about, if it is about one. Sent with the
    // thread so the invoice can be raised from inside the conversation rather
    // than from a second screen that has to be kept in step with it.
    let planRequest = null;
    if (rows[0].plan_change_request_id) {
      const [pr] = await pool.execute('SELECT * FROM plan_change_requests WHERE id = ?', [
        rows[0].plan_change_request_id,
      ]);
      if (pr[0]) {
        // Never fail the whole thread because Stripe is unreachable. The panel
        // copes with a missing price by saying so; a 500 here would take the
        // conversation down with it.
        let price = null;
        try {
          const plans = await getSignupPlans();
          const target = plans.find((p) => p.planType === pr[0].to_plan);
          if (target?.amountPerYear) price = { cents: target.amountPerYear, currency: target.currency || 'AUD' };
        } catch (err) {
          console.error('Could not read the plan price for the support thread', err.message);
        }

        planRequest = {
          id: pr[0].id,
          priceCents: price?.cents ?? null,
          priceCurrency: price?.currency ?? null,
          toPlan: pr[0].to_plan,
          fromPlan: pr[0].from_plan,
          status: pr[0].status,
          invoiceUrl: pr[0].invoice_url,
          invoiceAmountCents: pr[0].invoice_amount_cents,
          invoiceCurrency: pr[0].invoice_currency,
          invoiceDueAt: pr[0].invoice_due_at,
          paidAt: pr[0].paid_at,
          voidedAt: pr[0].voided_at,
        };
      }
    }

    res.json({
      ticket: shapeTicket(rows[0], { includeEmail: true }),
      messages: await messagesFor(rows[0].id, { includeNotes: true }),
      customer,
      planRequest,
    });
  })
);

router.post(
  '/support/tickets/:id/reply',
  requireSupportStaff,
  // Without this, a reply carrying an image arrives as an unparsed multipart
  // body: req.body is empty, the message reads as blank, and the reply is
  // refused with "write a message first" while the message sits on screen.
  upload.array('attachments', MAX_ATTACHMENTS_PER_MESSAGE),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    // Assigned to you, or nobody answers. This holds for administrators too —
    // it is not a permission check but a coordination one, and an administrator
    // replying to somebody else's open case causes exactly the confusion the
    // rule exists to prevent. Taking it first is one press.
    if (rows[0].assigned_to !== req.user.id) {
      return res.status(409).json({
        error: rows[0].assigned_to
          ? 'Somebody else is dealing with this one.'
          : 'Take this ticket first, then reply.',
      });
    }

    return addReply(req, res, rows[0], 'support');
  })
);

// Closing, and opening again. Only support can do either: a customer closing
// their own ticket is a different feature, and one nobody has asked for.
router.post(
  '/support/tickets/:id/status',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const closing = req.body?.status === 'closed';

    const [rows] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      [req.params.id]
    );
    const ticket = rows[0];
    if (!ticket) return res.status(404).json({ error: 'Not found' });

    if (closing) {
      await pool.execute(
        `UPDATE support_tickets SET status = 'closed', closed_at = NOW(), closed_by = ?, updated_at = NOW()
          WHERE id = ?`,
        [req.user.id, ticket.id]
      );

      // A plan change that was never invoiced dies with its conversation.
      //
      // Closing the ticket already retired the request everywhere that matters
      // — it stopped blocking a new one, stopped showing on the customer's
      // account — but the row itself was left saying 'pending'. So the admin
      // panel went on reporting a request as waiting months after it had been
      // answered and closed, which is the one place somebody looks to find out
      // what happened.
      //
      // Only the uninvoiced ones. An invoiced request has real money against
      // it and is cancelled deliberately, by voiding the invoice, not as a
      // side effect of tidying a queue.
      await pool
        .execute(
          `UPDATE plan_change_requests
              SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
            WHERE id = ? AND status = 'pending'`,
          [ticket.plan_change_request_id || 0]
        )
        .catch((err) => console.error('Could not close the plan request with its ticket', err.message));
    } else {
      // Back to needing a reply from us, not from them: whoever reopened it did
      // so because something was left undone at our end.
      await pool.execute(
        `UPDATE support_tickets SET status = 'awaiting_support', closed_at = NULL, closed_by = NULL,
           updated_at = NOW() WHERE id = ?`,
        [ticket.id]
      );
    }

    // Written into the thread so the conversation explains itself later, rather
    // than a reply appearing after a gap with nothing saying why.
    await pool.execute(
      `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
       VALUES (?, ?, 'system', ?, ?)`,
      [
        ticket.id,
        req.user.id,
        req.user.name || 'Support',
        closing ? 'Ticket closed.' : 'Ticket opened again.',
      ]
    );

    if (closing) {
      try {
        const to = ticket.user_id ? ticket.email : ticket.guest_email;
        const name = ticket.user_id ? ticket.name : ticket.guest_name;
        // A guest reads through their emailed link, which is the only address
        // they have — and the token is hashed here, so the email points at the
        // ticket page and asks them to use the link they already have.
        if (to) {
          await sendSupportClosedEmail(to, name, {
            reference: ticket.reference,
            subject: ticket.subject,
            category: categoryLabel(ticket.category),
            url: ticket.user_id ? ticketUrl(ticket) : `${appOrigin()}/support`,
          });
        }
      } catch (err) {
        console.error('Could not send the ticket-closed email', err);
      }
    }

    res.json({ ok: true, messages: await messagesFor(ticket.id, { includeNotes: true }) });
  })
);

// Support editing its own reply. Same rule as the customer's side: your own
// message only, and never once the ticket is closed.
router.patch(
  '/support/messages/:id',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT m.*, t.status, t.id AS ticket_id FROM support_messages m
         JOIN support_tickets t ON t.id = m.ticket_id WHERE m.id = ?`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row || row.author_user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    return editMessage(req, res, row, { id: row.ticket_id, status: row.status }, { includeNotes: true });
  })
);

// Taking a note back.
//
// Only notes, and only your own. A reply is something the customer has already
// read and been emailed, so removing it from the thread would leave the two
// sides of the same conversation disagreeing about what was said. A note has
// been read by nobody outside the team, so the person who wrote it is free to
// think better of it.
router.delete(
  '/support/messages/:id',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT m.id, m.author_user_id, m.author_role, m.ticket_id FROM support_messages m WHERE m.id = ?`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row || row.author_role !== 'note' || row.author_user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await pool.execute('DELETE FROM support_messages WHERE id = ?', [row.id]);
    res.json({ ok: true, messages: await messagesFor(row.ticket_id, { includeNotes: true }) });
  })
);

// Who a ticket can be raised for.
//
// Typed as an email or a name, because whoever is on the phone will give you
// one or the other and rarely the one you expected. Activated accounts only:
// an account that has never confirmed its address cannot read anything sent to
// it, so offering it would be offering a conversation with nobody.
//
// The status comes back with each match. Half of what support needs to know
// before writing is whether the person is on a trial, paying, or locked out —
// and picking the right Michael from three is easier with it on screen.
router.get(
  '/support/customers',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const search = String(req.query?.q || '').trim().slice(0, 80);
    if (search.length < 2) return res.json({ customers: [] });

    const like = `%${search}%`;
    const [rows] = await pool.execute(
      `SELECT id, name, email, plan_type, subscription_status, trial_ends_at, access_bypass, avatar_path
         FROM users
        WHERE activated_at IS NOT NULL
          AND role <> 'accountant'
          -- Never yourself. A ticket raised against your own account would
          -- sit in the queue as a customer waiting on a reply from the
          -- person who wrote it.
          AND id <> ?
          AND (email LIKE ? OR name LIKE ?)
        ORDER BY name
        LIMIT 8`,
      [req.user.id, like, like]
    );

    res.json({
      customers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        planType: r.plan_type || null,
        subscriptionStatus: r.subscription_status || null,
        trialEndsAt: r.trial_ends_at,
        accessBypass: Boolean(r.access_bypass),
        avatarUrl: r.avatar_path ? `/api/auth/avatar/${r.id}` : null,
      })),
    });
  })
);

// Raising a ticket for somebody else.
//
// Every ticket started on the customer's side, which assumes every
// conversation does. They do not: somebody rings up, or writes to a personal
// address, or an administrator spots a problem on an account before the person
// has noticed it. All of that was being handled outside the system and then
// summarised into it later, if at all — so the record of what was said lived
// in somebody's memory.
//
// The first message is written as support, because that is who wrote it. The
// ticket is assigned to whoever raised it: they started the conversation, so
// they own it, and it does not sit in the unassigned queue looking like work
// nobody has picked up. It opens as awaiting_customer for the same reason —
// the ball is with them, and a ticket we opened ourselves must not appear in
// "needs a reply".
//
// An address with no account gets the same guest treatment as somebody writing
// in from the public form: a token, and a link emailed to them. Otherwise
// there would be no way for the person to answer.
router.post(
  '/support/tickets',
  requireSupportStaff,
  upload.array('attachments', MAX_ATTACHMENTS_PER_MESSAGE),
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const subject = String(req.body?.subject || '').trim().slice(0, 200);
    const message = String(req.body?.message || '').trim();
    const category = isCategory(req.body?.category) ? req.body.category : 'other';
    const priority = isPriorityValue(req.body?.priority) ? req.body.priority : 'normal';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Enter the email address this is for' });
    }
    // The same rules a customer's own ticket is held to, from the same
    // functions. A ticket we raise is not a lesser one, and two sets of length
    // rules for the same two fields is two things to keep in step.
    const badSubject = subjectProblem(subject);
    if (badSubject) return res.status(400).json({ error: badSubject });
    const badMessage = messageProblem(message);
    if (badMessage) return res.status(400).json({ error: badMessage });

    // Activated only, matching the search. An unconfirmed address cannot read
    // what is sent to it, so a ticket against it would be a conversation with
    // nobody — it is treated as a stranger and emailed a guest link instead,
    // which at least reaches the mailbox.
    const [found] = await pool.execute(
      "SELECT id, name FROM users WHERE email = ? AND activated_at IS NOT NULL AND role <> 'accountant'",
      [email]
    );
    const owner = found[0] || null;

    // Who holds it. An administrator can hand it straight to whoever should
    // answer; anybody else keeps what they wrote. The same rule as transferring
    // an existing one, so there is no way in through the back door.
    let holder = req.user.id;
    if (req.user.isAdmin && req.body?.assignTo) {
      const target = Number(req.body.assignTo);
      const [staff] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND (is_support = 1 OR is_admin = 1)',
        [target]
      );
      if (!staff[0]) return res.status(400).json({ error: 'That person is not on the support team' });
      holder = target;
    }

    // A guest needs a way back in, and the only one there is is the link. An
    // account holder opens it from inside the app, so no token is minted for
    // them — one fewer credential in existence.
    let token = null;
    let tokenHash = null;
    if (!owner) ({ token, tokenHash } = generateAccessToken());

    let reference = generateReference();
    let ticketId = null;
    for (let attempt = 0; attempt < 3 && !ticketId; attempt += 1) {
      try {
        const [result] = await pool.execute(
          `INSERT INTO support_tickets
             (reference, user_id, guest_name, guest_email, category, subject, status, priority,
              assigned_to, assigned_at, access_token_hash, last_message_at, support_read_at)
           VALUES (?, ?, ?, ?, ?, ?, 'awaiting_customer', ?, ?, NOW(), ?, NOW(), NOW())`,
          [
            reference,
            owner?.id || null,
            owner ? null : email,
            owner ? null : email,
            category,
            subject,
            priority,
            holder,
            tokenHash,
          ]
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
       VALUES (?, ?, 'support', ?, ?)`,
      [ticketId, req.user.id, req.user.name || 'Support', message.slice(0, 5000)]
    );

    // After the insert: the folder is named after the ticket and the file after
    // the message, and neither id exists before this point.
    const attached = saveAttachments(ticketId, firstMessage.insertId, req.files);
    if (attached) {
      await pool.execute('UPDATE support_messages SET attachments = ? WHERE id = ?', [attached, firstMessage.insertId]);
    }

    // Told, if it went to somebody else. Being handed a conversation you did
    // not start, silently, is how one sits unanswered.
    if (holder !== req.user.id) {
      await notify(holder, {
        title: `${req.user.name || 'An administrator'} started a ticket for you`,
        body: `${reference} — ${subject}`,
        url: '/admin?tab=support',
        kind: 'support',
      }).catch(() => {});
    }

    // Emailed exactly like a reply, so they get the link and can answer. Never
    // allowed to fail the ticket: it exists, and losing it because a mail
    // server was slow would mean typing the whole thing again.
    try {
      const [rows] = await pool.execute(
        `SELECT t.*, u.name, u.email FROM support_tickets t
           LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
        [ticketId]
      );
      // fromSupport, not isNew. isNew sends "we have received your ticket" —
      // wrong for one we raised ourselves — and tells every administrator
      // about a new ticket one of them just created. This sends the
      // support-has-written-to-you email, which is what happened.
      //
      // guest_token is set on the row rather than passed: announce reads it
      // from there, and it is the only moment the plain token exists. Without
      // it a guest is sent to the support page and asked for a link they were
      // never given.
      await announce({ ...rows[0], guest_token: token }, { body: message, fromSupport: true });
    } catch (err) {
      console.error('Could not email the ticket we raised', err);
    }

    if (owner) {
      await notify(owner.id, {
        title: 'Taxify support has written to you',
        body: subject,
        url: `/support/${ticketId}`,
        kind: 'support',
      }).catch(() => {});
    }

    res.status(201).json({ ok: true, id: ticketId, reference, isGuest: !owner });
  })
);

// Everybody who can hold a ticket, so an administrator can choose.
router.get(
  '/support/staff',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, email, avatar_path, is_admin FROM users
        WHERE is_support = 1 OR is_admin = 1 ORDER BY name`
    );
    res.json({
      staff: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        isAdmin: Boolean(r.is_admin),
        avatarUrl: r.avatar_path ? `/api/auth/avatar/${r.id}` : null,
      })),
    });
  })
);

// Taking a ticket, or putting it back.
//
// Anybody on support may take an unassigned one. Only the person holding it, or
// an administrator, may hand it back — otherwise two people can pull it off
// each other while they are both typing.
// A handover, written into the conversation.
//
// Deliberately does not touch status or last_message_at. Somebody taking a
// ticket has not answered it, and marking it as replied to would drop it off
// the queue that exists to make sure it gets one.
//
// Never allowed to fail the handover itself: the assignment has already been
// made, and throwing here would report a failure for something that worked.
async function recordHandover(ticketId, body) {
  try {
    await pool.execute(
      `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
       VALUES (?, NULL, 'system', 'Taxify', ?)`,
      [ticketId, body]
    );
  } catch (err) {
    console.error('Could not record the handover on the ticket', err);
  }
}

router.post(
  '/support/tickets/:id/assign',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT id, assigned_to FROM support_tickets WHERE id = ?', [req.params.id]);
    const ticket = rows[0];
    if (!ticket) return res.status(404).json({ error: 'Not found' });

    const release = req.body?.release === true;
    if (release) {
      const mine = ticket.assigned_to === req.user.id;
      if (!mine && !req.user.isAdmin) {
        return res.status(403).json({ error: 'Only whoever is dealing with this can hand it back' });
      }
      await pool.execute(
        'UPDATE support_tickets SET assigned_to = NULL, assigned_at = NULL, updated_at = NOW() WHERE id = ?',
        [ticket.id]
      );
      await recordHandover(ticket.id, `${req.user.name || 'Support'} put this back in the queue`);
      return res.json({ ok: true, assignedTo: null });
    }

    // Somebody else already has it. Said plainly rather than silently taken —
    // quietly reassigning work out from under a colleague mid-reply is how two
    // half-answers reach one customer.
    if (ticket.assigned_to && ticket.assigned_to !== req.user.id && !req.user.isAdmin) {
      return res.status(409).json({ error: 'Somebody else is already dealing with this one' });
    }

    // An administrator may hand it to anyone, including themselves. Anybody
    // else may only take it.
    const target = req.body?.userId && req.user.isAdmin ? Number(req.body.userId) : req.user.id;

    if (target !== req.user.id) {
      const [staff] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND (is_support = 1 OR is_admin = 1)',
        [target]
      );
      if (!staff[0]) return res.status(400).json({ error: 'That person is not on the support team' });
    }

    await pool.execute(
      'UPDATE support_tickets SET assigned_to = ?, assigned_at = NOW(), updated_at = NOW() WHERE id = ?',
      [target, ticket.id]
    );

    // Written into the conversation, so who is dealing with it is part of the
    // record rather than a field that quietly changed. Both sides read it: a
    // customer waiting on an answer should be able to see that somebody has
    // picked it up and who, and the next person on the support side should be
    // able to see how it got to them.
    const [named] = await pool.execute('SELECT name FROM users WHERE id = ?', [target]);
    const who = named[0]?.name || 'a member of the support team';
    await recordHandover(
      ticket.id,
      target === req.user.id
        ? `${who} picked this up`
        : `${req.user.name || 'An administrator'} passed this to ${who}`
    );

    // Only the person it went to. Telling the whole team about a ticket none of
    // them can now answer is noise, and noise is what makes people stop reading
    // notifications — which costs far more than one missed handover.
    if (target !== req.user.id) {
      try {
        const [about] = await pool.execute('SELECT reference, subject FROM support_tickets WHERE id = ?', [ticket.id]);
        await notify(target, {
          title: `${req.user.name || 'An administrator'} passed you a ticket`,
          body: `${about[0]?.reference} — ${about[0]?.subject}`,
          url: '/admin?tab=support',
          kind: 'support',
        });
      } catch (err) {
        console.error('Could not tell them about the handover', err);
      }
    }

    res.json({ ok: true, assignedTo: target });
  })
);

// A note for whoever picks this up next. Never sent, never emailed, and
// filtered out of everything the customer can read — messagesFor drops it
// unless the caller asks for notes, so a route written later cannot leak one by
// forgetting.
router.post(
  '/support/tickets/:id/note',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    const body = String(req.body?.message || '').trim();
    if (!body) return res.status(400).json({ error: 'Write the note first' });

    const [rows] = await pool.execute('SELECT id FROM support_tickets WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    await pool.execute(
      `INSERT INTO support_messages (ticket_id, author_user_id, author_role, author_name, body)
       VALUES (?, ?, 'note', ?, ?)`,
      [rows[0].id, req.user.id, req.user.name || 'Support', body.slice(0, 5000)]
    );

    // Deliberately does not touch status or last_message_at. A note is not an
    // answer, and marking the ticket as replied to because somebody wrote
    // themselves a reminder would hide it from the queue.
    res.json({ ok: true, messages: await messagesFor(rows[0].id, { includeNotes: true }) });
  })
);

// How urgent it is. Set here rather than asked of the customer: everybody
// believes their own problem is urgent, so a field where they say so sorts
// nothing.
router.post(
  '/support/tickets/:id/priority',
  requireSupportStaff,
  asyncHandler(async (req, res) => {
    if (!isPriority(req.body?.priority)) {
      return res.status(400).json({ error: `Priority has to be one of: ${PRIORITIES.join(', ')}` });
    }
    const [result] = await pool.execute('UPDATE support_tickets SET priority = ?, updated_at = NOW() WHERE id = ?', [
      req.body.priority,
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, priority: req.body.priority });
  })
);

// Deleting a conversation, and everything it holds.
//
// The rows go by cascade; the files do not, so they are removed here. Order
// matters: files first, then the row. A row deleted before its files leaves
// nothing pointing at them, and they sit on disk forever with no way left to
// know which ticket they belonged to.
router.delete(
  '/support/tickets/:id',
  // Administrators only, unlike the rest of this file. Answering tickets is not
  // the same authority as erasing the record of one.
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT id, plan_change_request_id FROM support_tickets WHERE id = ?', [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    // A plan change dies with its conversation.
    //
    // Deleting the ticket left the request sitting at 'pending' with nothing
    // pointing at it, and the outstanding rule reads a missing ticket as "no
    // ticket yet" rather than "ticket gone" — so it counted as live for ever.
    // The customer's account went on saying a request was with us, and it
    // blocked them asking for anything else, with no way out from either side.
    //
    // Closing a ticket already does this. Deleting one is closing it and then
    // some, so it has to as well.
    if (rows[0].plan_change_request_id) {
      await pool
        .execute(
          `UPDATE plan_change_requests
              SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
            WHERE id = ? AND status = 'pending'`,
          [rows[0].plan_change_request_id]
        )
        .catch((err) => console.error('Could not close the plan request with its ticket', err.message));
    }

    try {
      removeTicketFiles(uploadsDir, rows[0].id);
    } catch (err) {
      // Said out loud rather than swallowed: the row is about to go, so this is
      // the last moment anybody could connect these files to anything.
      console.error(`Could not remove attachments for ticket ${rows[0].id}`, err);
    }

    await pool.execute('DELETE FROM support_tickets WHERE id = ?', [rows[0].id]);
    res.json({ ok: true });
  })
);

export default router;
