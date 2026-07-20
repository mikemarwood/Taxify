// Multi-tenant resolver + per-tenant pool factory.
//
// Tenants are identified by a company code stamped onto the request by
// Mike's App Hub (X-Tenant-Code header) or, as a fallback, a signed
// cookie set from the /company page. The code is looked up in the
// central mike_apphub database (tenant/apphub.js) which returns the
// tenant's MySQL credentials; this module owns the AsyncLocalStorage
// context, the per-tenant pool cache, and the proxyPool that every
// existing pool.query call site keeps using unchanged.
//
// Every HTTP request runs inside a tenantStore context keyed to the
// company code. Code that runs OUTSIDE any request (schema migrations
// at boot, scheduled jobs) wraps itself in
// `tenantStore.run(contextFor(tenant), …)` for whichever tenant it
// cares about. There is no "default" tenant — calls without an active
// context throw, on purpose, so a leak can never silently route to the
// wrong tenant's data.

import { AsyncLocalStorage } from 'async_hooks';
import mysql from 'mysql2/promise';
import { lookupTenantByCode, listActiveTenants, invalidateTenant } from './apphub.js';

// In-memory pool cache, keyed by the tenant's company code.
const poolCache = new Map(); // code -> mysql Pool

function _normalizeCode(code) {
  return String(code || '').toLowerCase().trim();
}

// Look up a tenant by company code. Returns null for an unknown /
// suspended / not-yet-provisioned code so the middleware can redirect
// the visitor back to /company.
export async function resolveByCode(code) {
  return lookupTenantByCode(code);
}

// Lazy-create + cache a connection pool for a tenant. connectionLimit
// is small (4) so N tenants x 4 connections stays under MySQL's
// default max_connections (151) at scale.
export function getPoolFor(tenant) {
  if (!tenant?.code || !tenant?.db?.name || !tenant?.db?.user) {
    throw new Error('[tenants] getPoolFor: tenant missing code/db');
  }
  const key = _normalizeCode(tenant.code);
  let p = poolCache.get(key);
  if (p) return p;
  p = mysql.createPool({
    host: tenant.db.host || 'localhost',
    port: Number(tenant.db.port) || 3306,
    user: tenant.db.user,
    password: tenant.db.pass,
    database: tenant.db.name,
    waitForConnections: true,
    connectionLimit: Number(tenant.db.connectionLimit) || 4,
    charset: 'utf8mb4',
    dateStrings: true,
  });
  poolCache.set(key, p);
  return p;
}

// Drop a single tenant's cached pool (after credential rotation, etc.)
// or every cached pool. New queries grab a fresh pool.
export async function invalidatePool(code) {
  if (!code) {
    const ps = Array.from(poolCache.values());
    poolCache.clear();
    await Promise.allSettled(ps.map((p) => p.end?.()));
    return;
  }
  const key = _normalizeCode(code);
  const p = poolCache.get(key);
  if (!p) return;
  poolCache.delete(key);
  try { await p.end?.(); } catch { /* draining pool, ignore */ }
  invalidateTenant(key);
}

// All currently-active tenants for this product. Used at boot to run
// schema migrations against every tenant DB.
export async function listTenants() {
  return listActiveTenants();
}

// =====================================================================
// Tenant context store — used by the proxyPool below so every
// `pool.query(...)` call site routes to the right tenant's backend
// without any of those call sites having to change.
// =====================================================================

export const tenantStore = new AsyncLocalStorage();

// Build the context object used inside tenantStore.run().
export function contextFor(tenant) {
  return { tenant, pool: getPoolFor(tenant) };
}

// The current request's tenant, or null outside any tenant context.
// Used to namespace upload directories by company_code.
export function getCurrentTenant() {
  return tenantStore.getStore()?.tenant || null;
}

function currentPool() {
  const ctx = tenantStore.getStore();
  if (!ctx?.pool) {
    throw new Error(
      '[tenants] pool.query called outside any tenant context. ' +
      'Wrap the caller in tenantStore.run(contextFor(tenant), ...).'
    );
  }
  return ctx.pool;
}

// Drop-in replacement for what used to be a single global pool. Every
// method delegates to whichever pool is the current context's tenant
// pool.
export const proxyPool = {
  query: (...a) => currentPool().query(...a),
  execute: (...a) => currentPool().execute(...a),
  getConnection: (...a) => currentPool().getConnection(...a),
  end: (...a) => currentPool().end(...a),
};
