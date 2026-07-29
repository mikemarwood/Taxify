import crypto from 'crypto';

export const ACTIVATION_TOKEN_DAYS = 5;

export function generateActivationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}
