// Tiny cookie helper — sign/verify the tf_tenant cookie that maps a
// browser session to a company code from mike_apphub. This is the
// fallback path for direct/manual access; the normal path is the
// hub's X-Tenant-Code header (see tenant/middleware.js).
//
// Format: <code>.<expEpochMs>.<hmacHex>
//   - code is the company_code from customer_apps
//   - exp is an absolute expiry; we refuse cookies past it
//   - hmac is HMAC-SHA256(secret, "<code>.<exp>") — guards against a
//     visitor crafting their own cookie to land in another tenant's DB

import crypto from 'crypto';

export const TENANT_COOKIE_NAME = 'tf_tenant';
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function _secret() {
  // Lazy read so a missing secret fails loudly the first time we try to
  // mint a cookie, not at module load.
  const s = process.env.TENANT_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      '[cookies] TENANT_COOKIE_SECRET env var must be set to a random ' +
      'string of at least 16 chars. Without it, anyone could forge a ' +
      "tenant cookie and read another tenant's data."
    );
  }
  return s;
}

function _sign(payload) {
  return crypto.createHmac('sha256', _secret()).update(payload).digest('hex');
}

export function signCode(code, ttlMs = DEFAULT_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const payload = `${code}.${exp}`;
  return `${payload}.${_sign(payload)}`;
}

export function verifyCookie(value) {
  if (typeof value !== 'string' || !value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [code, expStr, sig] = parts;
  if (!/^[a-z0-9_-]{1,50}$/.test(code)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = _sign(`${code}.${exp}`);
  // timingSafeEqual requires equal-length buffers — guard against an
  // attacker tampering with sig length to crash the comparison.
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return { code, exp };
}

export function buildSetCookie(name, value, opts = {}) {
  const parts = [`${name}=${value}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (opts.maxAgeMs != null) parts.push(`Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookie(name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
