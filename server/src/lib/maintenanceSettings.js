import { getSetting, setSetting } from '../db.js';
import { maintenanceNoticeFrom, stockNotice, validateMaintenanceInput } from './maintenance.js';

// The maintenance switch, read and written in one place.
//
// Separate from maintenance.js so that file stays pure and testable; this is
// the half that touches the settings table.

export const MAINTENANCE_KEYS = {
  enabled: 'maintenance_enabled',
  reason: 'maintenance_reason',
  message: 'maintenance_message',
};

// Read on every API request, so it is cached.
//
// Two seconds. Long enough that a busy page does not put a query behind every
// request it makes, short enough that switching the site off in the admin
// panel takes effect while the admin is still looking at the screen — anything
// longer and it reads as the switch not having worked.
const TTL_MS = 2000;
let cache = null;
let cachedAt = 0;

// Exported for tests, and for the admin write path: having just changed the
// setting, the next read must not be the stale one.
export function clearMaintenanceCache() {
  cache = null;
  cachedAt = 0;
}

async function read() {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;

  // Off unless explicitly switched on. The opposite of the Facebook setting,
  // and for the opposite reason: a feature that helps should work out of the
  // box, and a feature that locks everybody out should need somebody to have
  // meant it. A missing row, a fresh database or a failed migration must all
  // leave the site up.
  const enabled = (await getSetting(MAINTENANCE_KEYS.enabled)) === 'true';
  cache = {
    enabled,
    reason: (await getSetting(MAINTENANCE_KEYS.reason)) || 'maintenance',
    message: (await getSetting(MAINTENANCE_KEYS.message)) || '',
  };
  cachedAt = now;
  return cache;
}

// Null when the site is up; the notice to show when it is not.
export async function currentMaintenanceNotice() {
  const stored = await read();
  if (!stored.enabled) return null;
  return maintenanceNoticeFrom(stored);
}

// What the admin panel shows: the raw stored values, plus the stock wording
// for both reasons so the screen can preview what a visitor will actually see
// without a round trip per keystroke.
export async function readMaintenanceSettings() {
  const stored = await read();
  return {
    maintenanceEnabled: stored.enabled,
    maintenanceReason: stored.reason,
    maintenanceMessage: stored.message,
    maintenanceStock: {
      maintenance: stockNotice('maintenance'),
      technical: stockNotice('technical'),
    },
  };
}

// Returns an error message, or null when everything was written.
export async function writeMaintenanceSettings(body = {}) {
  const { maintenanceEnabled, maintenanceReason, maintenanceMessage } = body;

  // Nothing to do rather than an error: this shares an endpoint with the other
  // settings, and a request that only changes registration must not be
  // rejected for saying nothing about maintenance.
  if (
    maintenanceEnabled === undefined &&
    maintenanceReason === undefined &&
    maintenanceMessage === undefined
  ) {
    return null;
  }

  const problem = validateMaintenanceInput({
    enabled: maintenanceEnabled,
    reason: maintenanceReason,
    message: maintenanceMessage,
  });
  if (problem) return problem;

  if (maintenanceReason !== undefined) await setSetting(MAINTENANCE_KEYS.reason, maintenanceReason);
  if (maintenanceMessage !== undefined) {
    await setSetting(MAINTENANCE_KEYS.message, maintenanceMessage.trim());
  }
  // Last, so that switching the site off in the same request that sets the
  // wording never puts the old wording in front of anybody, however briefly.
  if (maintenanceEnabled !== undefined) {
    await setSetting(MAINTENANCE_KEYS.enabled, maintenanceEnabled ? 'true' : 'false');
  }

  clearMaintenanceCache();
  return null;
}
