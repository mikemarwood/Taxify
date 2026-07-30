import crypto from 'crypto';

// A small arithmetic challenge on the sign-up form. It won't stop anyone
// determined, but it stops the drive-by bots that post the same form all day,
// and it costs a real person one second of thought.
//
// Stateless on purpose: the challenge is carried in a signed token rather than
// held in server memory, so it survives a restart and doesn't need cleaning up.
// The token holds a hash of the answer, not the answer, so nothing readable
// travels with it.

const TOKEN_TTL_MS = 10 * 60 * 1000;

function secret() {
  // Reuses the app's signing secret; there's nothing here worth a second one.
  return process.env.JWT_SECRET || 'taxify-captcha';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function hashAnswer(answer, nonce) {
  return crypto.createHash('sha256').update(`${nonce}:${answer}`).digest('hex').slice(0, 32);
}

// Addition only, both operands small. Multiplication and subtraction trip
// people up more often than they raise the bar for a script.
export function createCaptcha() {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const nonce = crypto.randomBytes(8).toString('hex');
  const expires = Date.now() + TOKEN_TTL_MS;
  const body = `${nonce}.${expires}.${hashAnswer(a + b, nonce)}`;
  return {
    question: `${a} + ${b}`,
    token: `${body}.${sign(body)}`,
  };
}

export function verifyCaptcha(token, answer) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return false;

  const [nonce, expires, expected, signature] = parts;
  const body = `${nonce}.${expires}.${expected}`;

  const given = Buffer.from(signature, 'utf8');
  const ours = Buffer.from(sign(body), 'utf8');
  if (given.length !== ours.length || !crypto.timingSafeEqual(given, ours)) return false;

  if (!Number.isFinite(Number(expires)) || Number(expires) < Date.now()) return false;

  const supplied = Number(String(answer).trim());
  if (!Number.isInteger(supplied)) return false;
  return hashAnswer(supplied, nonce) === expected;
}
