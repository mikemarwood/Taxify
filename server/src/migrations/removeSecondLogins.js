// Turning a second login into its own account.
//
// The Family plan gave an account a second full login sharing the subscription.
// It could not work: `tax_years`, `vehicle_trips` and `home_office_hours` are
// all keyed to the account holder, so a household had exactly one 2025-2026 row
// between them. Two people with two jobs have two returns, and there was
// nowhere to put the second — whoever recorded a refund second overwrote the
// first, and finalising the year locked the other person out of editing their
// own expenses.
//
// So the feature is gone, and anyone holding one of those logins becomes an
// ordinary account holder instead. Nothing is deleted: they keep every expense
// and receipt they entered, and get their own trial so they are not locked out
// the moment they are on their own.
//
// This is expected to affect nothing. It exists so that if it does, nobody
// loses a year of receipts to a plan being renamed.

export async function migrateRemoveSecondLogins(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'second_logins_converted'`);
  if (flag.length > 0) return { skipped: true };

  const [members] = await pool.execute(
    `SELECT id, account_holder_id, email FROM users WHERE role = 'sub_user' AND account_holder_id IS NOT NULL`
  );

  for (const member of members) {
    // Their own set of books. Until now their expenses carried their own
    // user_id but the *holder's* entity_id, which is why they were visible to
    // neither of them together.
    const [existing] = await pool.execute('SELECT id FROM entities WHERE user_id = ? AND is_default = 1', [member.id]);
    let entityId = existing[0]?.id;
    if (!entityId) {
      const [created] = await pool.execute(
        `INSERT INTO entities (user_id, name, kind, lodgement_cadence, is_default, path_segment)
         VALUES (?, 'Individual', 'individual', 'annual', 1, NULL)`,
        [member.id]
      );
      entityId = created.insertId;
    }

    // Only rows they own. vehicle_trips, home_office_hours and tax_years are
    // keyed to the holder rather than to them — those were never theirs and
    // stay where they are.
    for (const table of ['expenses', 'categories']) {
      await pool.execute(`UPDATE ${table} SET entity_id = ? WHERE user_id = ?`, [entityId, member.id]);
    }

    // A fresh trial, because they arrive owning a subscription they have never
    // been asked about. Fourteen days matches a new sign-up.
    await pool.execute(
      `UPDATE users
       SET role = 'owner', account_holder_id = NULL, plan_type = 'individual',
           subscription_status = 'trialing', trial_ends_at = DATE_ADD(NOW(), INTERVAL 14 DAY)
       WHERE id = ?`,
      [member.id]
    );

    console.log(`[migration] second logins: ${member.email} is now their own account`);
  }

  // Everyone who was on the old plan is on the new one. Done unconditionally
  // rather than only for accounts that had a second login — the plan itself no
  // longer exists under that name.
  const [renamed] = await pool.execute(`UPDATE users SET plan_type = 'business' WHERE plan_type = 'family'`);

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('second_logins_converted', '1')`);

  if (members.length > 0 || renamed.affectedRows > 0) {
    console.log(
      `[migration] second logins: converted ${members.length}, moved ${renamed.affectedRows} account(s) to Small Business`
    );
  }
  return { converted: members.length, renamed: renamed.affectedRows };
}
