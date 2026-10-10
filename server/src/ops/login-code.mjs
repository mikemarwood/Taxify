// A login code, issued from the server's shell instead of by email.
//
// Two factors are required of every account and cannot be turned off, and the
// second one arrives by email — so a mail outage locks everybody out,
// administrator included, and the screen for fixing the mail server is on the
// far side of the login. This is the way back in. It needs shell access on the
// server, which is already total control, so it gives away nothing that was
// being protected.
//
// Order matters, because signing in issues a code of its own and overwrites
// whatever was there:
//
//   1. Enter your email and password in the app. The code screen will say the
//      email could not be sent — that is expected; leave the page open.
//   2. On the server:
//        cd /path/to/taxify/server && node src/ops/login-code.mjs you@example.com
//   3. Type the four digits it prints into the page from step 1.
//
// The code lasts half an hour rather than the usual five minutes, because the
// round trip here involves a person and an SSH session. Any wrong-code lockout
// on the account is cleared at the same time, since being locked out of the
// recovery path defeats the point of having one.
import 'dotenv/config';
import { generateOtp, hashOtp } from '../auth/otp.js';
import pool from '../db.js';

const TTL_MINUTES = 30;
const email = String(process.argv[2] || '').trim().toLowerCase();

try {
  if (!email) {
    console.error('Which account? Pass the email address:');
    console.error('  node src/ops/login-code.mjs you@example.com');
    process.exitCode = 2;
  } else {
    const [rows] = await pool.execute('SELECT id, email, name, is_admin FROM users WHERE LOWER(email) = ?', [email]);
    const user = rows[0];
    if (!user) {
      console.error(`No account with the address ${email}.`);
      process.exitCode = 1;
    } else {
      const code = generateOtp();
      const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
      await pool.execute(
        `UPDATE users
            SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0,
                otp_locked_until = NULL, otp_last_sent_at = NOW()
          WHERE id = ?`,
        [hashOtp(code), expiresAt, user.id]
      );

      console.log('');
      console.log(`  Account    ${user.email}${user.is_admin ? ' (administrator)' : ''}`);
      console.log(`  Code       ${code}`);
      console.log(`  Expires    ${expiresAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`);
      console.log('');
      console.log('  Type it into the code screen you already have open. If you have not');
      console.log('  signed in yet, do that first — signing in replaces this code.');
      console.log('');
      console.log('  Then fix the mail server, or this will be needed again:');
      console.log('    node src/ops/mail-check.mjs');
      console.log('');
    }
  }
} catch (err) {
  console.error('');
  console.error(`  Could not issue a code: ${err.message}`);
  console.error('  If this is a database error, check DB_* in server/.env.');
  console.error('');
  process.exitCode = 1;
} finally {
  await pool.end();
}
