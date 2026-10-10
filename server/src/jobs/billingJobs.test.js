import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeGraceExpired, NOTICE_GRACE_DAYS } from './billingJobs.js';

// An unactivated account is deleted five days in, after a courtesy email. When
// that email cannot be sent the row is kept and retried hourly — which, with a
// mail server down for a week, meant nothing was ever deleted and the admin
// panel promised a removal that never came. The grace period is what ends that
// wait, so these pin both of its edges.

const LIFETIME_DAYS = 5;
const hours = (days) => days * 24;

test('inside the grace period the account is kept for another try', () => {
  assert.equal(noticeGraceExpired(hours(LIFETIME_DAYS)), false);
  assert.equal(noticeGraceExpired(hours(LIFETIME_DAYS + NOTICE_GRACE_DAYS) - 1), false);
});

test('at the end of the grace period the account goes regardless', () => {
  assert.equal(noticeGraceExpired(hours(LIFETIME_DAYS + NOTICE_GRACE_DAYS)), true);
  assert.equal(noticeGraceExpired(hours(30)), true);
});

test('an age that is not a number keeps the account', () => {
  // The safe direction. A row whose age could not be read must not be deleted
  // on the strength of it.
  assert.equal(noticeGraceExpired(null), false);
  assert.equal(noticeGraceExpired(undefined), false);
  assert.equal(noticeGraceExpired('nonsense'), false);
  assert.equal(noticeGraceExpired(NaN), false);
});

test('an age read back as a string still counts', () => {
  // mysql2 hands back some numerics as strings depending on the column type,
  // and a string age silently failing Number.isFinite would reinstate the
  // deadlock this exists to break.
  assert.equal(noticeGraceExpired(String(hours(LIFETIME_DAYS + NOTICE_GRACE_DAYS))), true);
  assert.equal(noticeGraceExpired(String(hours(LIFETIME_DAYS))), false);
});
