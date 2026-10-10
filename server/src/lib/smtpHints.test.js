import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintForSmtpFailure } from './mailer.js';

// These exist because a wrong hint is worse than no hint — it gets followed.
// The first version of this matched "SSL routines", a string that appears in
// most of OpenSSL's errors, and told somebody to check their port setting
// while the real fault was a Postfix TLS map Postfix could not parse. Each
// case below is a real failure seen on the server.

const hint = (err) => hintForSmtpFailure(err);

test('an unverifiable certificate is sent to the chain reader, not guessed at', () => {
  const h = hint({ code: 'ESOCKET', message: 'unable to get local issuer certificate' });
  assert.match(h, /mail-check/);
  // Three faults share this message, so the hint must offer all of them and
  // settle on none. The version that said "usually" a missing intermediate
  // sent a real staging certificate off after the wrong fix.
  assert.match(h, /staging/i);
  assert.match(h, /self-signed/i);
  assert.match(h, /intermediate/i);
  assert.doesNotMatch(h, /usually|probably|most likely/i);
});

test('a handshake the server aborts does not blame the port', () => {
  const h = hint({
    code: 'ESOCKET',
    message: 'error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:... SSL alert number 80',
  });
  assert.match(h, /could not produce a certificate|maillog/i);
  assert.doesNotMatch(h, /STARTTLS/);
});

test('only a real version mismatch blames the port', () => {
  assert.match(hint({ message: 'wrong version number' }), /STARTTLS/);
  // "SSL routines" alone must match nothing about ports — it is in almost
  // every OpenSSL error string.
  const generic = hint({ message: 'error:0A0000EA:SSL routines::callback failed' });
  assert.equal(generic, null);
});

test('an SMTP status is matched as a code, not as digits in the text', () => {
  assert.match(hint({ responseCode: 535, message: 'Authentication credentials invalid' }), /credentials/);
  // A serial number or byte count containing 535 is not a refused login.
  assert.equal(hint({ message: 'certificate serial 2C6E5DFB535A0000' }), null);
  assert.equal(hint({ message: 'queue file 535 bytes written' }), null);
});

test('unreachable hosts are told apart from refused ones', () => {
  assert.match(hint({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND mail.example.com' }), /Nothing answered/);
});

test('an unrecognised failure gets no hint rather than a wrong one', () => {
  assert.equal(hint({ code: 'EENVELOPE', message: 'No recipients defined' }), null);
  assert.equal(hint({}), null);
  assert.equal(hint(), null);
});
