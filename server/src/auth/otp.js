import crypto from 'crypto';

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_LOCKOUT_MINUTES = 60;
export const OTP_REMINDER_INTERVAL_DAYS = 14;

export function generateOtp() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

export function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function isMfaPromptDue(lastPromptedAt) {
  if (!lastPromptedAt) return true;
  const elapsedMs = Date.now() - new Date(lastPromptedAt).getTime();
  return elapsedMs > OTP_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}
