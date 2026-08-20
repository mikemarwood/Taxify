// Everybody who already acts for somebody gets the flag.
//
// acts_for_clients arrived as a switch on the plan page and defaults to 0, so
// every accountant who existed before it had it off — they read as accountants
// only because they held an assignment. That is the inference this replaces,
// and it fails the moment the last client is removed: the flag is off, there
// are no assignments, and Your clients disappears from the sidebar of somebody
// who has been doing this for a year.
//
// It also fails on the way back. Re-inviting them creates an invitation, not an
// assignment, and Your clients is the only page where an invitation can be
// accepted — so the page they need is hidden until they have done the thing
// they need it for.
//
// The live check in middleware fixes the second half. This fixes the first, for
// the accounts that already exist: anybody holding an assignment now, and
// anybody who has ever accepted an invitation, is one.
export async function migrateAccountantFlag(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'accountant_flag_backfilled'`);
  if (flag.length > 0) return { skipped: true };

  // Expired assignments count. An accountant whose window closed last week is
  // still an accountant — the access ended, not the occupation.
  const [held] = await pool.execute(
    `UPDATE users u
        SET u.acts_for_clients = 1
      WHERE u.acts_for_clients = 0
        AND EXISTS (SELECT 1 FROM accountant_assignments a WHERE a.accountant_user_id = u.id)`
  );

  // And anybody who accepted an invitation, even if the assignment behind it
  // has since been removed — which is precisely the case that reported this.
  const [accepted] = await pool.execute(
    `UPDATE users u
        SET u.acts_for_clients = 1
      WHERE u.acts_for_clients = 0
        AND EXISTS (SELECT 1 FROM accountant_invites i WHERE i.accepted_user_id = u.id)`
  );

  // Somebody whose role is literally 'accountant' was created to act for
  // others and has never been anything else.
  const [role] = await pool.execute(
    `UPDATE users SET acts_for_clients = 1 WHERE acts_for_clients = 0 AND role = 'accountant'`
  );

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('accountant_flag_backfilled', '1')`);

  const total = held.affectedRows + accepted.affectedRows + role.affectedRows;
  if (total > 0) {
    console.log(`[migration] accountants: flagged ${total} account(s) that already act for clients`);
  }
  return { flagged: total };
}
