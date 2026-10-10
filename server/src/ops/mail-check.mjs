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
import { describeCertChain } from '../lib/certChain.js';
import pool from '../db.js';

// Terminal output, so the paragraphs are wrapped rather than left as one line
// that the window folds mid-word.
function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

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

      // A certificate failure says nothing about which certificate failure it
      // is, and the fixes have nothing in common — so the chain is read back
      // and named rather than left for somebody to go and decode by hand.
      if (/certificate|CERT_|altname|SSL routines/i.test(failed.detail || '')) {
        const seen = report.config.secure
          ? await describeCertChain({ host: report.config.host, port: report.config.port })
          : null;
        console.log('');
        if (seen) {
          console.log('  What the server is presenting:');
          console.log('');
          for (const line of seen.lines) console.log(line);
          console.log('');
          if (seen.verdict) {
            // Wrapped by hand: this is read in a terminal, and one 300-column
            // line is the paragraph nobody reads.
            for (const line of wrap(seen.verdict, 74)) console.log(`  ${line}`);
            console.log('');
          }
        } else {
          console.log('  To see what the mail server is presenting:');
          console.log(
            `    openssl s_client -connect ${report.config.host}:${report.config.port} ` +
              `-servername ${report.config.host} </dev/null 2>&1 | head -40`
          );
          console.log('');
        }
      } else {
        console.log('');
      }
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
