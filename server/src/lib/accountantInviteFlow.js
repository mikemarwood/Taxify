import pool from '../db.js';
import { notify } from './notify.js';
import {
  sendAccountantInviteAcceptedEmail,
  sendAccountantInviteDeclinedEmail,
  sendAccountantInviteExpiredEmail,
} from './mailer.js';

// What happens to an invitation, in one place.
//
// There are three endings — accepted, declined, or nobody answered — and each
// one has to tell the client, in the app and by email. That is three near
// identical blocks of "look up the owner, notify, send, never let the email
// failing undo the thing that worked", and they were going to be written three
// times in a route file that is already two thousand lines.
//
// The rule they share: the record is written first and the telling comes
// second, inside a try. A failed email must never undo an acceptance — the
// access has already been granted, and throwing would leave the accountant
// looking at an error for something that worked.

// The scope, as a client would say it.
function scopeLabel(invite) {
  return invite.financial_years
    ? `FY ${String(invite.financial_years).split(',').join(', ')}`
    : 'every year';
}

async function ownerAndAccountant(invite, accountantUserId) {
  const [owner] = await pool.execute('SELECT name, email FROM users WHERE id = ?', [invite.owner_user_id]);
  const who = accountantUserId
    ? (await pool.execute('SELECT name, email FROM users WHERE id = ?', [accountantUserId]))[0]
    : [];
  return { owner: owner[0] || null, accountant: who[0] || null };
}

// Accepted. The assignment is written, the invitation is closed, and the client
// is told both ways.
export async function acceptInvite(invite, accountantUserId) {
  await pool.execute(
    // entity_ids carried across from the invitation. Without it, a client who
    // invited somebody to one set of books would find on acceptance that they
    // had handed over all of them.
    //
    // access_level carried across too. It was not, so every invitation accepted
    // became read-only whatever the client had chosen — the write option
    // existed on the form and was silently discarded here.
    `INSERT INTO accountant_assignments
       (accountant_user_id, owner_user_id, financial_years, entity_ids, access_level, window_hours)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE financial_years = VALUES(financial_years),
       entity_ids = VALUES(entity_ids), access_level = VALUES(access_level),
       window_hours = VALUES(window_hours)`,
    [
      accountantUserId,
      invite.owner_user_id,
      invite.financial_years,
      invite.entity_ids,
      // Anything that is not exactly write is read, the same rule the
      // invitation route applies. A stray value must not hand over edit rights.
      invite.access_level === 'write' ? 'write' : 'read',
      invite.window_hours,
    ]
  );

  await pool.execute(
    `UPDATE accountant_invites
        SET accepted_at = NOW(), accepted_user_id = ?,
            -- Moved rather than thrown away. It stops being a credential either
            -- way; keeping it as a lookup key is what lets a second click on an
            -- old link be recognised and answered properly.
            spent_token_hash = COALESCE(spent_token_hash, token_hash),
            token_hash = NULL
      WHERE id = ?`,
    [accountantUserId, invite.id]
  );

  await notify(invite.owner_user_id, {
    title: 'Your accountant accepted',
    body: 'They can now open your books. You will be told the first time they do.',
    url: '/account',
    kind: 'accountant',
  });

  try {
    const { owner, accountant } = await ownerAndAccountant(invite, accountantUserId);
    if (owner?.email) {
      await sendAccountantInviteAcceptedEmail(
        owner.email,
        owner.name,
        accountant?.name || invite.name,
        accountant?.email || invite.email,
        scopeLabel(invite)
      );
    }
  } catch (err) {
    console.error('Could not tell the client their invitation was accepted', err);
  }
}

// Declined. Nothing is granted, the invitation is closed, and the row clears
// itself from the client's pending list because that list only reads open ones.
export async function declineInvite(invite, accountantUserId) {
  await pool.execute(
    `UPDATE accountant_invites
        SET declined_at = NOW(),
            spent_token_hash = COALESCE(spent_token_hash, token_hash),
            token_hash = NULL
      WHERE id = ?`,
    [invite.id]
  );

  await notify(invite.owner_user_id, {
    title: 'Your accountant declined',
    body: 'Nothing was shared. You can invite somebody else whenever you are ready.',
    url: '/account',
    kind: 'accountant',
  });

  try {
    const { owner, accountant } = await ownerAndAccountant(invite, accountantUserId);
    if (owner?.email) {
      await sendAccountantInviteDeclinedEmail(
        owner.email,
        owner.name,
        accountant?.name || invite.name,
        accountant?.email || invite.email
      );
    }
  } catch (err) {
    console.error('Could not tell the client their invitation was declined', err);
  }
}

// Nobody answered and the time ran out.
//
// The one ending a client could never find out about: they invited somebody,
// heard nothing, and the invitation quietly stopped working with no sign of it.
// Swept rather than scheduled, because a timer that has to survive a restart is
// a worse thing to own than a query that asks what is already true.
//
// expired_notified_at is stamped before the telling, not after, so a sweep that
// fails halfway through does not tell the same client twice on the next run.
// The cost of that order is that a crashed send is never retried, which is the
// better of the two failures: a missed email is quiet, a repeated one is not.
export async function sweepExpiredInvites() {
  const [rows] = await pool.execute(
    `SELECT i.*, u.name AS owner_name, u.email AS owner_email
       FROM accountant_invites i
       JOIN users u ON u.id = i.owner_user_id
      WHERE i.accepted_at IS NULL
        AND i.declined_at IS NULL
        AND i.expired_notified_at IS NULL
        AND i.expires_at <= NOW()`
  );
  if (rows.length === 0) return 0;

  for (const invite of rows) {
    await pool.execute(
      `UPDATE accountant_invites SET expired_notified_at = NOW(), token_hash = NULL WHERE id = ?`,
      [invite.id]
    );

    try {
      await notify(invite.owner_user_id, {
        title: 'Your accountant invitation expired',
        body: `${invite.email} did not answer. Nothing was shared, and the invitation has been cleared.`,
        url: '/account',
        kind: 'accountant',
      });
      if (invite.owner_email) {
        await sendAccountantInviteExpiredEmail(invite.owner_email, invite.owner_name, invite.email);
      }
    } catch (err) {
      console.error('Could not tell the client their invitation expired', err);
    }
  }

  return rows.length;
}
