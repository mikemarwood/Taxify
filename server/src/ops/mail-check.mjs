// Why mail is not going out, printed from the server's shell.
//
// The same checks as Admin > Email server, which is the problem: that screen
// is behind a login, the login needs a code, and the code arrives by email —
// so the hour SMTP breaks is the hour the diagnosis becomes unreachable
// through the product. This reads the settings out of the same database and
// runs the same report, needing nothing but shell access.
//
//   cd /path/to/taxify/server && node src/ops/mail-check.mjs [address]
//
// The address is where the test message goes; the SMTP account's own address
// is the sensible choice, and is the default when none is given.
import 'dotenv/config';
import { diagnoseSmtp, getSmtpConfig } from '../lib/mailer.js';
import pool from '../db.js';

const to = process.argv[2];

try {
  const config = await getSmtpConfig();
  const target = to || config.user || '';
  if (!target) {
    console.error('No address to test with, and the SMTP account has none. Pass one:');
    console.error('  node src/ops/mail-check.mjs you@example.com');
    process.exitCode = 2;
  } else {
    const report = await diagnoseSmtp(target);

    console.log('');
    console.log(`  Host        ${report.config.host || '(not set)'}:${report.config.port}`);
    console.log(`  Encryption  ${report.config.secure ? 'TLS' : 'STARTTLS or plain'}`);
    console.log(`  Account     ${report.config.user || '(none — sending unauthenticated)'}`);
    console.log(`  Password    ${report.config.hasPassword ? 'set' : 'NOT SET'}`);
    console.log(`  From        ${report.config.from || '(not set)'}`);
    console.log(`  Envelope    ${report.config.envelopeFrom || '(none)'}`);
    console.log(`  Testing to  ${target}`);
    console.log('');

    for (const check of report.checks) {
      console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.step}`);
      if (check.detail) console.log(`       ${check.detail}`);
    }

    const failed = report.checks.find((c) => !c.ok);
    console.log('');
    if (failed) {
      console.log(`  Mail is not going out. First failure: ${failed.step}`);

      // The one command that settles a certificate failure, with the host and
      // port already filled in. A chain that stops at depth 0 is a missing
      // intermediate on the mail server; anything else is a certificate that
      // genuinely is not trusted.
      if (/certificate|CERT_|altname|SSL routines/i.test(failed.detail || '')) {
        console.log('');
        console.log('  To see what the mail server is actually presenting:');
        console.log(
          `    openssl s_client -connect ${report.config.host}:${report.config.port} ` +
            `-servername ${report.config.host} </dev/null 2>&1 | head -40`
        );
      }
      console.log('');
      // Worth saying here, because this is the script somebody runs when they
      // cannot sign in, and the connection between the two is not obvious.
      console.log('  While this is broken, login codes cannot be emailed. To get in:');
      console.log('    node src/ops/login-code.mjs <your-email>');
      process.exitCode = 1;
    } else {
      console.log(`  Mail is working — the relay accepted a test message for ${target}.`);
    }
    console.log('');
  }
} catch (err) {
  console.error('');
  console.error(`  Could not run the check: ${err.message}`);
  console.error('  If this is a database error, check DB_* in server/.env.');
  console.error('');
  process.exitCode = 1;
} finally {
  await pool.end();
}
