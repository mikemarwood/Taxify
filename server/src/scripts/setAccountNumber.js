/*
 * One-off: give an existing account its public account number.
 *
 * Account numbers were added after some accounts already existed, and
 * assignAccountNumber only runs at registration — so anybody who signed up
 * before it exists with account_number NULL and sees nothing where the number
 * should be.
 *
 * Run from anywhere:
 *
 *   node server/src/scripts/setAccountNumber.js mike.marwood@hotmail.com
 *
 * Deliberately refuses an account that already has one. This number is what a
 * person quotes back to support and what appears on their invoices; changing it
 * because a script was run twice would leave two different numbers meaning the
 * same account. Pass --force if a change is genuinely intended.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// The .env is found relative to this file, not to wherever the script was run
// from.
//
// `import 'dotenv/config'` reads ./.env in the working directory. That works for
// the server, which pm2 starts inside server/ — and fails for anybody running
// this from the repo root, which is the natural place to run it from and what
// the usage line above tells them to do. The symptom is "No database selected":
// the pool connects with an undefined database name, because DB_NAME was never
// loaded.
const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '..', '.env');
dotenv.config({ path: envPath });

if (!process.env.DB_NAME) {
  console.error(`No DB_NAME found. Looked in: ${envPath}`);
  process.exit(1);
}

// Imported dynamically, and only now. db.js reads process.env at the moment it
// loads, so a static import would be hoisted above the dotenv call and see
// nothing — which is the exact bug this comment exists to stop somebody
// reintroducing by tidying these into ordinary imports at the top.
const { default: pool } = await import('../db.js');
const { assignAccountNumber, isAccountNumber } = await import('../lib/accountNumber.js');

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
  // first, and saying so, because a --force that quietly did nothing would be
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
