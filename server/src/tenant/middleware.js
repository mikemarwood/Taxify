// Express wiring for the tenant pipeline described in tenant/tenants.js.
//
// Resolution order per request:
//   1. X-Tenant-Code header — stamped by Mike's App Hub after it
//      resolves the visitor's domain. This is the normal path.
//   2. Signed tf_tenant cookie — set by POST /api/tenant-select (the
//      /company fallback page), for direct/manual access.
//   3. Neither present -> HTML requests are redirected to /company,
//      API requests get 401 { error: 'no_tenant' }.
//
// Trusting a request header is only safe because this app sits behind
// the hub's reverse proxy. If this app's port is ever reachable
// directly, set TENANT_PROXY_SECRET and have the hub send a matching
// X-Tenant-Proxy-Secret header so a visitor can't forge a tenant by
// sending X-Tenant-Code themselves.

import {
  resolveByCode,
  contextFor,
  tenantStore,
} from './tenants.js';
import {
  TENANT_COOKIE_NAME,
  signCode,
  verifyCookie,
  buildSetCookie,
  buildClearCookie,
} from './cookies.js';

const TENANT_PROXY_SECRET = process.env.TENANT_PROXY_SECRET || '';
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function headerTenantCode(headers) {
  if (!headers) return '';
  if (TENANT_PROXY_SECRET && headers['x-tenant-proxy-secret'] !== TENANT_PROXY_SECRET) return '';
  const raw = headers['x-tenant-code'];
  if (!raw) return '';
  const code = String(raw).toLowerCase().trim();
  return /^[a-z0-9_-]{1,50}$/.test(code) ? code : '';
}

function wantsJson(req) {
  const accept = String(req.headers.accept || '');
  return req.xhr || req.path.startsWith('/api/') || accept.includes('application/json');
}

// Keep the underlying error message (mysql "Access denied for user...",
// "ECONNREFUSED", a bad-registry-row explanation, etc.) so the person
// typing the code — usually whoever is setting the tenant up — can see
// *why* it failed instead of a bare "something went wrong". These
// messages come from mysql2/our own code, never from user input, but
// are still trimmed and length-capped before they go anywhere near a
// URL or HTML response.
function safeDetail(err) {
  const msg = String(err?.message || err || '').replace(/[\r\n]+/g, ' ').trim();
  return msg.slice(0, 300);
}

function redirectToCompany(res, error, detail) {
  const qs = new URLSearchParams({ error });
  if (detail) qs.set('detail', detail);
  return res.redirect(302, `/company?${qs.toString()}`);
}

// Paths that must resolve with no tenant context at all — the
// /company gate itself, its API, static assets, and the public
// marketing landing page (pure client-rendered content, no
// tenant-scoped API calls, so it must never be gated behind a
// company code — this is also what Mike's App Hub fetches to build
// the public /apps/taxify listing page).
const PUBLIC_PATHS = new Set([
  '/company',
  '/api/tenant-select',
  '/api/tenant-clear',
  '/api/tenant-current',
  '/favicon.ico',
  '/landing',
]);

function isPublicPath(reqPath) {
  if (PUBLIC_PATHS.has(reqPath)) return true;
  if (reqPath.startsWith('/assets/')) return true; // built client JS/CSS chunks
  if (reqPath.startsWith('/downloads/')) return true;
  return false;
}

// Main pipeline middleware — mount before any route that touches the
// database or per-tenant storage.
export function tenantMiddleware(req, res, next) {
  if (isPublicPath(req.path)) return next();

  const isApi = req.path.startsWith('/api/');
  const headerCode = headerTenantCode(req.headers);
  const cookies = req.cookies || {};
  const verified = verifyCookie(cookies[TENANT_COOKIE_NAME]);
  const code = headerCode || verified?.code || '';

  if (!code) {
    if (isApi) return res.status(401).json({ error: 'no_tenant' });
    return res.redirect(302, '/company');
  }

  resolveByCode(code)
    .then((tenant) => {
      if (!tenant) {
        if (headerCode) {
          // Header came from the hub itself — the domain mapping is
          // stale/misconfigured, not a bad manual code.
          if (isApi) return res.status(404).json({ error: 'tenant_inactive' });
          return res.redirect(302, '/company?error=tenant_inactive');
        }
        res.setHeader('Set-Cookie', buildClearCookie(TENANT_COOKIE_NAME));
        if (isApi) return res.status(401).json({ error: 'tenant_inactive' });
        return res.redirect(302, '/company?error=tenant_inactive');
      }

      // Resolved via the hub header but the cookie is missing or points
      // at a different tenant — (re)mint it so header-less follow-up
      // requests (e.g. static asset loads) still resolve correctly.
      if (headerCode && verified?.code !== tenant.code) {
        try {
          const value = signCode(tenant.code, COOKIE_TTL_MS);
          res.setHeader('Set-Cookie', buildSetCookie(TENANT_COOKIE_NAME, value, {
            maxAgeMs: COOKIE_TTL_MS,
            secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
          }));
        } catch (err) {
          console.error('[tenant] cookie mint from header failed:', err.message);
        }
      }

      let ctx;
      try {
        ctx = contextFor(tenant);
      } catch (err) {
        console.error(`[tenant] pool create failed for "${tenant.code}":`, err.message);
        if (isApi) return res.status(503).json({ error: 'tenant_db_unreachable', detail: safeDetail(err) });
        return redirectToCompany(res, 'tenant_unreachable', safeDetail(err));
      }
      req.tenant = ctx.tenant;
      tenantStore.run(ctx, () => next());
    })
    .catch((err) => {
      console.error('[tenant] apphub lookup failed:', err.message);
      if (isApi) return res.status(503).json({ error: 'lookup_failed', detail: safeDetail(err) });
      return redirectToCompany(res, 'lookup_failed', safeDetail(err));
    });
}

// GET /company — the manual company-code entry form. Self-contained
// HTML so it renders without depending on the built client bundle.
export function companyPage(req, res) {
  const error = String(req.query.error || '');
  const message = error ? COMPANY_ERRORS[error] || 'Something went wrong. Please try again.' : '';
  const detail = safeDetail(req.query.detail || '');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderCompanyHtml(message, detail));
}

const COMPANY_ERRORS = {
  invalid_code: 'That company code was not recognized.',
  tenant_inactive: 'That company account is not active.',
  tenant_unreachable: "That company's database could not be reached. Please try again shortly.",
  lookup_failed: 'Lookup temporarily unavailable. Please try again shortly.',
};

function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// Branded to match the Taxify client (client/src/theme.css): dark
// navy background, blue/violet/cyan gradient card accents, Inter font.
function renderCompanyHtml(message, detail) {
  const detailHtml = detail ? `<div class="error-detail">${escapeHtml(detail)}</div>` : '';
  const errorHtml = message ? `<div class="error">${escapeHtml(message)}${detailHtml}</div>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0a0f18" />
<title>Taxify — Company Access</title>
<style>
  :root {
    --bg: #0a0f18;
    --bg-elevated: #0f1826;
    --bg-card: #101a2b;
    --border: #1e2c3f;
    --text: #e8eef7;
    --text-muted: #8fa2ba;
    --violet: #2563eb;
    --cyan: #06b6d4;
    --blue: #3b82f6;
    --red: #ef4444;
    --gradient-brand: linear-gradient(135deg, var(--blue), var(--violet) 55%, var(--cyan));
    --shadow-glow: 0 0 0 1px rgba(59, 130, 246, 0.25), 0 8px 30px rgba(37, 99, 235, 0.15);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background:
      radial-gradient(circle at 15% 0%, rgba(59, 130, 246, 0.16), transparent 40%),
      radial-gradient(circle at 85% 20%, rgba(6, 182, 212, 0.14), transparent 40%),
      var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: var(--shadow-glow);
    width: 100%;
    max-width: 380px;
    padding: 36px 32px;
  }
  .logo {
    display: block;
    margin: 0 auto 20px;
    width: 56px;
    height: 56px;
    border-radius: 14px;
  }
  h1 {
    font-size: 19px;
    font-weight: 700;
    margin: 0 0 6px;
    text-align: center;
  }
  .subtitle {
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
    margin: 0 0 24px;
    line-height: 1.5;
  }
  label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 6px;
    display: block;
  }
  input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 15px;
    outline: none;
    margin-bottom: 18px;
    letter-spacing: 0.02em;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  input:focus {
    border-color: var(--violet);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
  }
  button {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 12px;
    border: none;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    background: var(--gradient-brand);
    color: white;
    box-shadow: 0 4px 20px rgba(37, 99, 235, 0.35);
    transition: filter 0.15s ease, transform 0.15s ease;
  }
  button:hover:not(:disabled) { filter: brightness(1.08); }
  button:active:not(:disabled) { transform: scale(0.98); }
  button:disabled { opacity: 0.6; cursor: default; }
  .spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: white;
    animation: spin 0.7s linear infinite;
    display: none;
  }
  button.loading .spinner { display: inline-block; }
  button.loading .btn-text { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #fca5a5;
    font-size: 13px;
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 16px;
  }
  .error-detail {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(239, 68, 68, 0.25);
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #f0a4a4;
    word-break: break-word;
  }
  .footer {
    margin-top: 22px;
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
</head>
<body>
  <div class="card">
    <svg class="logo" width="56" height="56" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2563eb"/>
          <stop offset="55%" stop-color="#3b82f6"/>
          <stop offset="100%" stop-color="#06b6d4"/>
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="120" height="120" rx="26" fill="#0a0f18"/>
      <rect x="4" y="4" width="120" height="120" rx="26" fill="url(#bg)" fill-opacity="0.95"/>
      <rect x="36" y="38" width="56" height="13" rx="6.5" fill="#f8fafc"/>
      <rect x="57.5" y="38" width="13" height="54" rx="6.5" fill="#f8fafc"/>
      <circle cx="82" cy="90" r="7" fill="#67e8f9"/>
    </svg>
    <h1>Enter your company code</h1>
    <p class="subtitle">This is the company code assigned to your Taxify account on Mike's App Hub. It connects you to your organization's own workspace.</p>
    ${errorHtml}
    <form id="f">
      <label for="code">Company code</label>
      <input id="code" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. acme" required />
      <button type="submit" id="submitBtn">
        <span class="spinner"></span>
        <span class="btn-text">Continue</span>
      </button>
    </form>
    <p class="footer">Powered by Mike's App Hub</p>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.classList.add('loading');
      const code = document.getElementById('code').value.trim();
      try {
        const r = await fetch('/api/tenant-select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.ok) {
          window.location.href = '/';
        } else {
          const qs = new URLSearchParams({ error: data.error || 'invalid_code' });
          if (data.detail) qs.set('detail', data.detail);
          window.location.href = '/company?' + qs.toString();
        }
      } catch (err) {
        window.location.href = '/company?error=lookup_failed';
      }
    });
  </script>
</body>
</html>`;
}

// POST /api/tenant-select — { code } -> sets the signed cookie.
export async function tenantSelect(req, res) {
  try {
    const code = String(req.body?.code || '').toLowerCase().trim();
    if (!/^[a-z0-9_-]{1,50}$/.test(code)) {
      return res.status(400).json({ error: 'invalid_code' });
    }
    let tenant;
    try {
      tenant = await resolveByCode(code);
    } catch (err) {
      console.error('[tenant-select] apphub lookup failed:', err.message);
      return res.status(503).json({ error: 'lookup_failed', detail: safeDetail(err) });
    }
    if (!tenant) return res.status(400).json({ error: 'invalid_code' });

    // Smoke-test the tenant DB before handing out a cookie that would
    // just produce errors on every page load. Also primes the pool cache.
    try {
      const ctx = contextFor(tenant);
      await ctx.pool.query('SELECT 1');
    } catch (err) {
      console.error(`[tenant-select] tenant "${code}" DB unreachable:`, err.message);
      return res.status(503).json({ error: 'tenant_unreachable', detail: safeDetail(err) });
    }

    let value;
    try {
      value = signCode(tenant.code, COOKIE_TTL_MS);
    } catch (err) {
      console.error('[tenant-select] signCode failed (TENANT_COOKIE_SECRET unset?):', err.message);
      return res.status(500).json({ error: 'lookup_failed', detail: safeDetail(err) });
    }
    res.setHeader('Set-Cookie', buildSetCookie(TENANT_COOKIE_NAME, value, {
      maxAgeMs: COOKIE_TTL_MS,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    }));
    res.json({ ok: true, code: tenant.code });
  } catch (err) {
    console.error('[tenant-select] unexpected:', err?.stack || err?.message || err);
    res.status(500).json({ error: 'lookup_failed', detail: safeDetail(err) });
  }
}

export function tenantClear(req, res) {
  res.setHeader('Set-Cookie', buildClearCookie(TENANT_COOKIE_NAME));
  res.json({ ok: true });
}

export function tenantCurrent(req, res) {
  const cookies = req.cookies || {};
  const verified = verifyCookie(cookies[TENANT_COOKIE_NAME]);
  if (!verified) return res.status(204).end();
  res.json({ code: verified.code });
}
