import crypto from 'crypto';
import pool from '../db.js';

// An invitation to look at somebody's books.
//
// It grants nothing. Nothing that decides access — hasAssignments,
// findAssignment, expenseScope — consults this table at all; accepting is what
// creates the assignment, and the assignment is what grants. Keeping that line
// sharp is the point of the table existing.

// Deliberately short. An invitation is an offer to read somebody's complete
// financial records, and an offer that sits in a mailbox for five days is five
// days of a live link nobody is watching. If it lapses, the client resends —
// which is one click and tells them it happened.
export const INVITE_LIFETIME_HOURS = 24;

// The same hashing as an activation token: the plain token is emailed and never
// stored, so a copy of the table is not a set of working links.
export function generateInviteToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + INVITE_LIFETIME_HOURS * 60 * 60 * 1000),
  };
}

export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function shapeInvite(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || null,
    financialYears: row.financial_years ? row.financial_years.split(',') : null,
    windowHours: row.window_hours,
    expiresAt: row.expires_at,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
  };
}

// Invitations this account is still waiting on. Expired ones are not listed —
// the sweep emails and removes them, so a client is told rather than left
// looking at a row that stopped working at some point they cannot determine.
export async function pendingInvites(ownerId) {
  const [rows] = await pool.execute(
    `SELECT * FROM accountant_invites
     WHERE owner_user_id = ? AND accepted_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [ownerId]
  );
  return rows.map(shapeInvite);
}

// Looked up by the hash of what arrived, so a wrong or replayed token simply
// finds nothing.
export async function findInviteByToken(token) {
  if (!token) return null;
  const [rows] = await pool.execute(
    `SELECT i.*, u.name AS owner_name, u.email AS owner_email
     FROM accountant_invites i
     JOIN users u ON u.id = i.owner_user_id
     WHERE i.token_hash = ?`,
    [hashInviteToken(token)]
  );
  return rows[0] || null;
}

// What should happen when somebody follows an invitation link. Pure, and split
// out from the route precisely so the branch below can be tested without a
// database — because one of these outcomes is an account-takeover bug if it is
// ever wrong.
export function inviteAcceptOutcome({ invite, existingUser, now = new Date() }) {
  if (!invite) return 'not_found';
  if (invite.accepted_at) return 'already_accepted';
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return 'expired';
  if (existingUser && existingUser.id === invite.owner_user_id) return 'self_invite';

  // An invitation token proves control of a mailbox and nothing more. If it
  // could also set a password on an account that already exists, forwarding an
  // invitation email would be a way to take over that account. So an address
  // that already has a login is *linked* — a new assignment against the user
  // who is already there — and never written to.
  if (existingUser && existingUser.activated_at) return 'link_existing';

  return 'create_login';
}

// Invitations nobody accepted. Emailed, then deleted — the deletion is what the
// 24 hours means, and the email is so the client finds out from us rather than
// from noticing the row is gone.
export async function closeExpiredInvites(sendLapsedEmail) {
  const [rows] = await pool.execute(
    `SELECT i.id, i.email, i.name, i.owner_user_id, u.name AS owner_name, u.email AS owner_email
     FROM accountant_invites i
     JOIN users u ON u.id = i.owner_user_id
     WHERE i.accepted_at IS NULL AND i.expires_at < NOW()`
  );
  if (rows.length === 0) return 0;

  for (const row of rows) {
    if (typeof sendLapsedEmail === 'function') {
      await sendLapsedEmail(row).catch((err) =>
        console.error(`Failed to tell ${row.owner_email} their invitation lapsed`, err.message)
      );
    }
  }

  const [result] = await pool.query(
    `DELETE FROM accountant_invites WHERE id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id)
  );
  return result.affectedRows || 0;
}
