import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fillDays,
} from './adminStats.js';

// The same local-date rule fillDays uses. toISOString() is UTC, which is a day
// out for most of the day in Australia — the bug these tests caught.
function isoDayLocal(d = new Date()) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}
import {
  shouldTouch,
  resetPresenceThrottle,
  ONLINE_WINDOW_MINUTES,
} from './presence.js';

test('the chart gets a row for every day, including the ones with nothing in them', () => {
  // SQL only returns days that have rows. Without the gaps filled the chart
  // draws a straight line between two busy days, which reads as steady use
  // rather than as a week when nobody came.
  const filled = fillDays([], 30);
  assert.equal(filled.length, 30);
  assert.ok(filled.every((d) => d.count === 0));
  // Oldest first, and the last one is today.
  assert.equal(filled[29].date, isoDayLocal());
});

test('a day that has rows keeps its count', () => {
  const today = isoDayLocal();
  const filled = fillDays([{ day: today, count: 7 }], 7);
  assert.equal(filled[6].count, 7);
  assert.equal(filled.slice(0, 6).reduce((n, d) => n + d.count, 0), 0);
});

test('presence writes at most once a minute for the same account', () => {
  resetPresenceThrottle();
  const now = Date.now();
  assert.equal(shouldTouch(1, now), true);
  // Every authenticated request would otherwise be an extra UPDATE — a single
  // screen loads six endpoints, which would be six writes to one row.
  assert.equal(shouldTouch(1, now + 5000), false);
  assert.equal(shouldTouch(1, now + 61000), true);
});

test('one account being throttled does not throttle another', () => {
  resetPresenceThrottle();
  const now = Date.now();
  assert.equal(shouldTouch(1, now), true);
  assert.equal(shouldTouch(2, now), true);
});

test('the online window is a small number of minutes', () => {
  // Guards against somebody "fixing" a quiet page by widening this until
  // everyone who visited today counts as online.
  assert.ok(ONLINE_WINDOW_MINUTES > 0 && ONLINE_WINDOW_MINUTES <= 15);
});
