/*
 * One-off: give an existing account its public account number.
 *
 * Account numbers were added after some accounts already existed, and
 * assignAccountNumber only runs at registration — so anybody who signed up
 * before it exists with account_number NULL and sees nothing where the number
 * should be.
 *
 * Run on the server, from the repo root:
 *
 *   node server/src/scripts/setAccountNumber.js mike.marwood@hotmail.com
 *
 * It reads server/.env the same way the app does, so it talks to the same
 * database with the same credentials and there is nothing to configure.
 *
 * Deliberately refuses an account that already has one. This number is what a
 * person quotes back to support and what appears on their invoices; changing it
 * because a script was run twice would leave two different numbers meaning the
 * same account. Pass --force if a change is genuinely intended.
 */

import 'dotenv/config';
import pool from '../db.js';
import { assignAccountNumber, isAccountNumber } from '../lib/accountNumber.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
const force = process.argv.includes('--force');

if (!email) {
  console.error('Usage: node server/src/scripts/setAccountNumber.js <email> [--force]');
  process.exit(1);
}

try {
  const [rows] = await pool.execute('SELECT id, email, name, account_number FROM users WHERE email = ?', [email]);
  const user = rows[0];

  if (!user) {
    console.error(`No account with that address: ${email}`);
    process.exit(1);
  }

  if (user.account_number && isAccountNumber(user.account_number) && !force) {
    console.log(`${user.email} already has account number ${user.account_number}. Nothing changed.`);
    console.log('Pass --force if you really mean to give them a different one.');
    process.exit(0);
  }

  const before = user.account_number;

  // assignAccountNumber only writes WHERE account_number IS NULL — it is written
  // to be safe to call twice, so on its own it would read the existing number
  // back rather than replace it. Forcing therefore means clearing the column
  // first, and saying so, because --force that quietly did nothing would be
  // worse than no flag at all.
  if (force && before) {
    await pool.execute('UPDATE users SET account_number = NULL WHERE id = ?', [user.id]);
    console.log(`Clearing ${before} first, because --force was passed.`);
  }
  // The same function registration uses, so the number produced here is
  // indistinguishable from one issued normally — eight digits, no leading zero,
  // and retried against the unique index rather than checked first.
  const assigned = await assignAccountNumber(pool, user.id);

  if (!assigned) {
    console.error('Could not allocate a number. Every attempt collided, which should be effectively impossible.');
    process.exit(1);
  }

  console.log(`${user.name || user.email}`);
  console.log(`  before: ${before || '(none)'}`);
  console.log(`  now:    ${assigned}`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
