import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function isStrongPassword(plain) {
  return typeof plain === 'string' && STRONG_PASSWORD_RE.test(plain);
}
