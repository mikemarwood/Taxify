// Central registry connector: reads tenant DB credentials out of the
// shared mike_apphub database (one DB serving every product on Mike's
// App Hub). The flow is:
//
//   1. The hub resolves a visitor's domain to a company_code and
//      forwards the request with an X-Tenant-Code header (see
//      tenant/middleware.js), or a returning visitor carries a signed
//      tenant cookie from the /company fallback page.
//   2. We look up customer_apps WHERE app_products.slug = '<our slug>'
//      AND customer_apps.company_code = <code> AND status = 'active'.
//   3. The row gives us db_host / db_port / db_name / db_user /
//      db_password — handed to tenant/tenants.js to spin up a
//      per-tenant pool against the tenant's own MySQL database.
//
// This module is the ONLY place in the app that talks to mike_apphub.
// Everything else routes through tenant/tenants.js so a tenant lookup
// can never accidentally expose a connection to mike_apphub itself.
//
// db_password values may be stored encrypted (`enc:<iv>:<ct>:<tag>`,
// AES-256-GCM) keyed off CENTRAL_ENCRYPTION_KEY, matching how
// MikesAppHub itself stores them. If the key is unset, plaintext rows
// are accepted; rows that still have the `enc:` prefix can't be
// decrypted without the key and surface as a loud error rather than a
// silent miss.

import mysql from 'mysql2/promise';
import crypto from 'crypto';

const APPHUB_HOST = process.env.APPHUB_DB_HOST || 'localhost';
const APPHUB_USER = process.env.APPHUB_DB_USER || 'mike_apphub';
const APPHUB_PASS = process.env.APPHUB_DB_PASS || '';
const APPHUB_NAME = process.env.APPHUB_DB_NAME || 'mike_apphub';
const PRODUCT_SLUG = process.env.APPHUB_PRODUCT_SLUG || 'taxify';

let _pool = null;
function pool() {
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: APPHUB_HOST,
    user: APPHUB_USER,
    password: APPHUB_PASS,
    database: APPHUB_NAME,
    waitForConnections: true,
    connectionLimit: 4,
    charset: 'utf8mb4',
  });
  return _pool;
}

function _encKey() {
  const raw = process.env.CENTRAL_ENCRYPTION_KEY;
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

function decryptSecret(value) {
  if (value == null) return value;
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value;
  const key = _encKey();
  if (!key) {
    throw new Error(
      '[apphub] customer_apps.db_password is encrypted (enc:...) but ' +
      'CENTRAL_ENCRYPTION_KEY is not set in this process. Set the same ' +
      'key MikesAppHub uses, or store the password as plaintext.'
    );
  }
  const [, ivHex, ctHex, tagHex] = value.split(':');
  const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  dec.setAuthTag(Buffer.from(tagHex, 'hex'));
  const pt = Buffer.concat([dec.update(Buffer.from(ctHex, 'hex')), dec.final()]);
  return pt.toString('utf8');
}

// Light in-memory cache so we don't hit mike_apphub on every request.
// 60s is short enough that DB-credential rotations or status flips
// (active/suspended/cancelled) propagate quickly without dragging the
// hot path. Populated on every successful lookup; misses are NOT
// cached so a freshly-created tenant doesn't have to wait a minute to
// be found.
const cache = new Map(); // code -> { at, tenant }
const CACHE_TTL_MS = 60 * 1000;

function _normalizeCode(code) {
  return String(code || '').toLowerCase().trim();
}

function _isValidCode(code) {
  // Match the customer_apps.company_code shape the hub uses: short,
  // alphanumeric + dash/underscore. Rejecting other characters keeps
  // SQL params clean even though we always parameterize.
  return /^[a-z0-9_-]{1,50}$/.test(code);
}

function _shapeRow(row) {
  if (!row) return null;
  return {
    code: row.company_code,
    customerId: row.customer_id,
    customerAppId: row.customer_app_id,
    company: row.company || null,
    serverName: row.server_name || null,
    appUrl: row.app_url || null,
    status: row.status,
    db: {
      host: row.db_host || 'localhost',
      port: row.db_port || 3306,
      name: row.db_name,
      user: row.db_user,
      pass: decryptSecret(row.db_password),
    },
  };
}

// Look up a tenant by company code. Returns null when the code doesn't
// exist for our product or the install isn't active — callers
// translate that to "invalid company code" without leaking which of
// the two it was.
export async function lookupTenantByCode(rawCode) {
  const code = _normalizeCode(rawCode);
  if (!code || !_isValidCode(code)) return null;
  const hit = cache.get(code);
  if (hit && (Date.now() - hit.at) < CACHE_TTL_MS) return hit.tenant;
  const [rows] = await pool().query(
    `SELECT ca.id AS customer_app_id, ca.company_code, ca.status, ca.app_url,
            ca.server_name, ca.db_host, ca.db_port, ca.db_name, ca.db_user,
            ca.db_password, c.id AS customer_id, c.company
       FROM customer_apps ca
       JOIN app_products ap ON ap.id = ca.app_product_id
       JOIN customers   c  ON c.id  = ca.customer_id
      WHERE ap.slug        = ?
        AND ca.company_code = ?
        AND ca.status       = 'active'
      LIMIT 1`,
    [PRODUCT_SLUG, code],
  );
  const row = rows[0];
  if (!row) return null;
  if (!row.db_name || !row.db_user || row.db_password == null) {
    // status='active' but the hub admin hasn't finished provisioning
    // the DB yet. Treat as a miss so the lookup fails clean instead of
    // crashing on pool creation.
    return null;
  }
  const tenant = _shapeRow(row);
  cache.set(code, { at: Date.now(), tenant });
  return tenant;
}

// Bust a single code's cache entry (or all of them).
export function invalidateTenant(code) {
  if (!code) cache.clear();
  else cache.delete(_normalizeCode(code));
}

// All currently-active installs of this product. Used at boot to run
// schema migrations against every tenant DB.
export async function listActiveTenants() {
  const [rows] = await pool().query(
    `SELECT ca.id AS customer_app_id, ca.company_code, ca.status, ca.app_url,
            ca.server_name, ca.db_host, ca.db_port, ca.db_name, ca.db_user,
            ca.db_password, c.id AS customer_id, c.company
       FROM customer_apps ca
       JOIN app_products ap ON ap.id = ca.app_product_id
       JOIN customers   c  ON c.id  = ca.customer_id
      WHERE ap.slug  = ?
        AND ca.status = 'active'
        AND ca.db_name IS NOT NULL
        AND ca.db_user IS NOT NULL
        AND ca.db_password IS NOT NULL`,
    [PRODUCT_SLUG],
  );
  return rows.map(_shapeRow);
}
