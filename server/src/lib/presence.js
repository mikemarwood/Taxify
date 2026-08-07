import pool from '../db.js';

// How recently an account must have made a request to count as here.
export const ONLINE_WINDOW_MINUTES = 5;

// One write per account per minute, at most. Every authenticated request would
// otherwise mean an extra UPDATE — on a page that loads six endpoints that is
// six writes to the same row for one screen, and the column is only ever read
// at minute resolution anyway.
const WRITE_EVERY_MS = 60 * 1000;
const lastWritten = new Map();

// Bounded so a long-running process cannot accumulate a row per account that
// ever signed in. Well above any plausible number of people online at once, so
// in practice nothing is ever evicted while it still matters.
const MAX_TRACKED = 10000;

export function shouldTouch(userId, now = Date.now()) {
  const previous = lastWritten.get(userId);
  if (previous && now - previous < WRITE_EVERY_MS) return false;
  if (lastWritten.size >= MAX_TRACKED) lastWritten.clear();
  lastWritten.set(userId, now);
  return true;
}

// Deliberately not awaited by callers: presence is a statistic, and a request
// should never be slowed down — or worse, fail — because a stats column could
// not be written. Errors are swallowed for the same reason.
export function touchLastSeen(userId) {
  if (!userId || !shouldTouch(userId)) return;
  pool.execute('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [userId]).catch(() => {});
}

// Test seam — the throttle is process-wide state.
export function resetPresenceThrottle() {
  lastWritten.clear();
}
