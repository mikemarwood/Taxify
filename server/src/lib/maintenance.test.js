import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAINTENANCE_REASONS,
  MAX_MESSAGE_LENGTH,
  isAlwaysAllowed,
  isMaintenanceReason,
  maintenanceNoticeFrom,
  stockNotice,
  validateMaintenanceInput,
} from './maintenance.js';

test('the two reasons say different things', () => {
  // The whole point of offering a choice. Planned work and a fault leave the
  // reader in a different state and deserve different words; one generic
  // "we'll be back soon" covering both tells them neither.
  const planned = maintenanceNoticeFrom({ reason: 'maintenance' });
  const broken = maintenanceNoticeFrom({ reason: 'technical' });

  assert.notEqual(planned.heading, broken.heading);
  assert.notEqual(planned.body, broken.body);
  assert.match(planned.heading, /maintenance/i);
  assert.match(broken.heading, /technical difficulties/i);
});

test('both reasons promise the records are safe', () => {
  // The one thing somebody locked out of their own tax records wants to know,
  // and the thing they will otherwise spend the outage worrying about.
  for (const reason of MAINTENANCE_REASONS) {
    const notice = maintenanceNoticeFrom({ reason });
    assert.match(notice.body, /safe|where you left them|nothing has been lost/i, reason);
  }
});

test('an unrecognised reason falls back to maintenance rather than throwing', () => {
  // This is read on every request during an outage. A bad value in the
  // settings table must not turn a planned outage into a crash loop.
  for (const bad of [undefined, null, '', 'catastrophe', 42, {}]) {
    const notice = maintenanceNoticeFrom({ reason: bad });
    assert.equal(notice.reason, 'maintenance');
    assert.ok(notice.heading);
    assert.ok(notice.body);
  }
});

test('a custom message replaces the body but never the heading', () => {
  const notice = maintenanceNoticeFrom({
    reason: 'technical',
    message: 'Our database provider is having an outage. Back by 6pm.',
  });
  assert.equal(notice.body, 'Our database provider is having an outage. Back by 6pm.');
  assert.equal(notice.custom, true);
  // The heading is what makes the two situations distinguishable at a glance.
  assert.equal(notice.heading, stockNotice('technical').heading);
});

test('a message of nothing but spaces is not a custom message', () => {
  const notice = maintenanceNoticeFrom({ reason: 'maintenance', message: '   \n  ' });
  assert.equal(notice.custom, false);
  assert.equal(notice.body, stockNotice('maintenance').body);
});

test('input is checked before it is stored', () => {
  assert.equal(validateMaintenanceInput({}), null);
  assert.equal(validateMaintenanceInput({ enabled: true, reason: 'technical' }), null);

  assert.match(validateMaintenanceInput({ enabled: 'yes' }), /true or false/);
  assert.match(validateMaintenanceInput({ reason: 'wednesday' }), /maintenance or technical/);
  assert.match(validateMaintenanceInput({ message: 12 }), /must be text/);
  assert.match(validateMaintenanceInput({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }), /at most/);

  // Exactly at the limit is fine, and so is a long message padded with spaces
  // — it is trimmed before it is measured.
  assert.equal(validateMaintenanceInput({ message: 'x'.repeat(MAX_MESSAGE_LENGTH) }), null);
  assert.equal(validateMaintenanceInput({ message: `  ${'x'.repeat(MAX_MESSAGE_LENGTH)}  ` }), null);
});

test('signing in still works while the site is off', () => {
  // Without this the feature is a way to lock yourself out of your own site:
  // switching it on and then signing in as an admin needs the login route, and
  // login needs the second factor behind it.
  assert.ok(isAlwaysAllowed('/auth/login'));
  assert.ok(isAlwaysAllowed('/auth/otp/verify'));
  assert.ok(isAlwaysAllowed('/auth/otp/resend'));
  assert.ok(isAlwaysAllowed('/auth/me'));
  assert.ok(isAlwaysAllowed('/auth/logout'));
  assert.ok(isAlwaysAllowed('/maintenance'));
});

test('a trailing slash does not slip past the allow list, or get caught by it', () => {
  assert.ok(isAlwaysAllowed('/auth/login/'));
  assert.equal(isAlwaysAllowed('/auth/login/extra'), false);
});

test('everything else is held', () => {
  // Registering during an outage creates an account that cannot be activated,
  // and a password reset sends mail that lands on a door which will not open —
  // so neither is on the list, even though both live under /auth.
  for (const path of [
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/expenses',
    '/export/summary',
    '/admin/users',
    '/',
  ]) {
    assert.equal(isAlwaysAllowed(path), false, path);
  }
});

test('isMaintenanceReason accepts only the two', () => {
  assert.ok(isMaintenanceReason('maintenance'));
  assert.ok(isMaintenanceReason('technical'));
  assert.equal(isMaintenanceReason('Maintenance'), false);
  assert.equal(isMaintenanceReason(''), false);
});
