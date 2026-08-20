import pool from '../db.js';

// Whether an account may start, or stop, acting for other people's books.
//
// "Accountant" was never something you chose. It was a side effect: isAccountant
// meant "has at least one live assignment", so you became one by being invited
// and stopped being one when the last client's access lapsed. That is fine for
// somebody who only ever acts for others, and no use at all to an ordinary
// account holder who also does a couple of sets of books for family — there was
// nothing they could turn on.
//
// acts_for_clients is that switch. isAccountant is now "has assignments, or has
// said they act for clients", so nothing about an invited accountant changes.

// What has to be quiet before the switch may move, in either direction.
//
// Turning it on while somebody is already sharing books with you, or off while
// you still hold somebody's, would change what the word means underneath live
// access — and the guards on every read are written in terms of it. Turning it
// off with an invitation in flight is worse still: the invitation would be
// accepted into an account that no longer claims to act for anyone.
//
// Sent and received both count. An invitation you sent is a promise somebody
// else is deciding on, and it is not yours alone to invalidate by changing what
// your account is.
export async function accountantRoleBlockers(user) {
  const id = user.id;
  const email = String(user.email || '').toLowerCase();

  const [[held]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM accountant_assignments
      WHERE accountant_user_id = ? AND (expires_at IS NULL OR expires_at > NOW())`,
    [id]
  );
  const [[given]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM accountant_assignments
      WHERE owner_user_id = ? AND (expires_at IS NULL OR expires_at > NOW())`,
    [id]
  );
  const [[received]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM accountant_invites
      WHERE email = ? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at > NOW()`,
    [email]
  );
  const [[sent]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM accountant_invites
      WHERE owner_user_id = ? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at > NOW()`,
    [id]
  );

  const blockers = [];
  if (Number(held.n) > 0) blockers.push('clients');
  if (Number(given.n) > 0) blockers.push('accountant');
  if (Number(received.n) > 0) blockers.push('invitation_received');
  if (Number(sent.n) > 0) blockers.push('invitation_sent');
  return blockers;
}

// Said the way somebody would say it, and pointing at the thing to do about it.
export function describeBlocker(blocker) {
  switch (blocker) {
    case 'clients':
      return 'you are still acting for at least one client — decline or wait for that access to end first';
    case 'accountant':
      return 'somebody still has accountant access to your books — remove it from your account first';
    case 'invitation_received':
      return 'an invitation is waiting for you to accept or decline';
    case 'invitation_sent':
      return 'you have an invitation out that nobody has answered yet — cancel it first';
    default:
      return 'there is something outstanding on your account';
  }
}
