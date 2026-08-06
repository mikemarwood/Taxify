// Moving the half-invited accountants onto the new footing.
//
// An accountant invited under the old scheme has a users row with `role` set to
// accountant, no activated_at, and a password that is thirty-two random bytes
// nobody has ever seen. That row is not a login — it is an invitation wearing a
// login's clothes, and it is why three separate things went wrong: the
// unactivated sweep deleted it after five days and took the client's grant with
// it, a second client inviting the same address matched it and was told to sign
// in with credentials that never existed, and the owner's list could not tell
// it apart from somebody who had accepted.
//
// This copies each one into accountant_invites, verifies every last one landed,
// and only then removes the placeholder rows.
//
// If it never runs, nothing breaks: /auth/accept-invite still handles the old
// shape, so anyone mid-flight can still accept and is walked through the rest
// by the setup card. This is a tidy-up, not a correctness dependency.

export async function migrateAccountantInvites(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'accountant_invites_migrated'`);
  if (flag.length > 0) return { skipped: true };

  // One invitation per (client, address). A placeholder with two assignments
  // was two clients waiting on the same person, so it becomes two invitations.
  //
  // Their real expiry is carried over rather than refreshed. A token that has
  // already lapsed surfaces as an expired invitation the client can resend,
  // which is the honest state — quietly extending it would hand out a live link
  // to somebody who stopped expecting one days ago.
  const [copied] = await pool.execute(
    `INSERT IGNORE INTO accountant_invites
       (owner_user_id, email, name, financial_years, window_hours, token_hash, expires_at, last_sent_at, created_at)
     SELECT a.owner_user_id, u.email, u.name, a.financial_years, a.window_hours,
            u.activation_token_hash,
            COALESCE(u.activation_token_expires_at, a.created_at),
            a.created_at, a.created_at
     FROM users u
     JOIN accountant_assignments a ON a.accountant_user_id = u.id
     WHERE u.role = 'accountant' AND u.activated_at IS NULL`
  );

  // Nothing may be deleted until every placeholder has an invitation to show
  // for it. This is the correctness condition, not a precaution: the foreign
  // key cascades, so deleting a row whose copy failed destroys a client's
  // pending invitation with no trace of it having existed.
  const [[stranded]] = await pool.query(
    `SELECT COUNT(*) AS n FROM users u
     JOIN accountant_assignments a ON a.accountant_user_id = u.id
     LEFT JOIN accountant_invites i ON i.owner_user_id = a.owner_user_id AND i.email = u.email
     WHERE u.role = 'accountant' AND u.activated_at IS NULL AND i.id IS NULL`
  );

  if (Number(stranded.n) > 0) {
    console.error(
      `[migration] accountant invites: ${stranded.n} placeholder(s) have no invitation yet — leaving them alone`
    );
    return { partial: true, copied: copied.affectedRows, stranded: Number(stranded.n) };
  }

  // A never-activated accountant owns nothing by construction — they could
  // never sign in to create anything. The expenses check is the cheap proof of
  // that rather than the assumption, and costs one query.
  const [removed] = await pool.execute(
    `DELETE FROM users
     WHERE role = 'accountant'
       AND activated_at IS NULL
       AND is_admin = 0
       AND id NOT IN (SELECT DISTINCT user_id FROM expenses)`
  );

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('accountant_invites_migrated', '1')`);

  console.log(
    `[migration] accountant invites: moved ${copied.affectedRows} invitation(s) and removed ${removed.affectedRows} placeholder login(s)`
  );
  return { copied: copied.affectedRows, removed: removed.affectedRows };
}
