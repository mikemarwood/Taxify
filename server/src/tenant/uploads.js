// Per-tenant upload/data directory helper. Every tenant's files live
// under data/<company_code>/... so nothing is ever shared between
// tenants on disk, matching the per-tenant DB isolation in tenants.js.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getCurrentTenant } from './tenants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.join(__dirname, '..', '..', 'data');

function currentCompanyCode() {
  const tenant = getCurrentTenant();
  if (!tenant?.code) {
    throw new Error(
      '[tenant/uploads] no tenant on the current request context — ' +
      'this must be called from inside a request handled by tenantMiddleware.'
    );
  }
  return tenant.code;
}

// data/<company_code>/uploads
export function tenantUploadsDir() {
  const dir = path.join(DATA_ROOT, currentCompanyCode(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// data/<company_code>/uploads/avatars
export function tenantAvatarsDir() {
  const dir = path.join(tenantUploadsDir(), 'avatars');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
