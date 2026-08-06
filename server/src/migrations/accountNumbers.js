import { assignAccountNumber } from '../lib/accountNumber.js';

// Gives every account that predates the column a public number.
//
// One at a time and one retry loop each, because the whole point is that the
// numbers are random — there is no bulk UPDATE that produces distinct random
// values and respects a unique key. Accounts are counted in tens, so this
// costs nothing.
//
// Not guarded by a settings flag, unlike the others here. The guard is the
// WHERE clause: only rows with no number are touched, so a run after a partly
// failed one picks up exactly what is left.
export async function migrateAccountNumbers(pool) {
  const [rows] = await pool.query('SELECT id FROM users WHERE account_number IS NULL ORDER BY id');
  if (rows.length === 0) return { assigned: 0 };

  let assigned = 0;
  for (const row of rows) {
    try {
      await assignAccountNumber(pool, row.id);
      assigned += 1;
    } catch (err) {
      // One account that cannot be numbered must not stop the rest, and must
      // not stop the server booting — everything still works off users.id.
      console.error(`[migration] account numbers: user ${row.id} could not be given one —`, err.message);
    }
  }

  console.log(`[migration] account numbers: gave ${assigned} account${assigned === 1 ? '' : 's'} a public number`);
  return { assigned };
}
