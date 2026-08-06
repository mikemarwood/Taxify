import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteAcceptOutcome, generateInviteToken, hashInviteToken, INVITE_LIFETIME_HOURS } from './accountantInvites.js';

const NOW = new Date('2026-08-06T10:00:00Z');
const live = (over = {}) => ({
  id: 1,
  owner_user_id: 10,
  email: 'sarah@chenco.com',
  expires_at: new Date('2026-08-07T09:00:00Z'),
  accepted_at: null,
  ...over,
});

test('an address with no login gets one', () => {
  assert.equal(inviteAcceptOutcome({ invite: live(), existingUser: null, now: NOW }), 'create_login');
});

test('an address that already has a login is linked, never written to', () => {
  // The one that matters. An invitation token proves control of a mailbox and
  // nothing else — if it could also set a password on an account that already
  // exists, forwarding an invitation email would be account takeover.
  const outcome = inviteAcceptOutcome({
    invite: live(),
    existingUser: { id: 42, activated_at: new Date('2025-01-01') },
    now: NOW,
  });
  assert.equal(outcome, 'link_existing');
  assert.notEqual(outcome, 'create_login');
});

test('a leftover row that was never activated is not a login', () => {
  // A half-invited placeholder from the old scheme has a random password nobody
  // knows. Treating it as an existing login is what produced the dead end where
  // somebody was told to sign in with credentials that never existed.
  assert.equal(
    inviteAcceptOutcome({ invite: live(), existingUser: { id: 42, activated_at: null }, now: NOW }),
    'create_login'
  );
});

test('an expired invitation is refused', () => {
  const outcome = inviteAcceptOutcome({
    invite: live({ expires_at: new Date('2026-08-06T09:59:59Z') }),
    existingUser: null,
    now: NOW,
  });
  assert.equal(outcome, 'expired');
});

test('the boundary is exclusive — expiring exactly now has expired', () => {
  assert.equal(
    inviteAcceptOutcome({ invite: live({ expires_at: NOW }), existingUser: null, now: NOW }),
    'expired'
  );
});

test('a link that has already been used cannot be used again', () => {
  assert.equal(
    inviteAcceptOutcome({ invite: live({ accepted_at: new Date('2026-08-06T09:00:00Z') }), existingUser: null, now: NOW }),
    'already_accepted'
  );
  // Checked before expiry, so a replayed old link reads as used rather than
  // merely stale — which is the more useful thing to tell somebody.
  assert.equal(
    inviteAcceptOutcome({
      invite: live({ accepted_at: new Date('2026-01-01'), expires_at: new Date('2026-01-02') }),
      existingUser: null,
      now: NOW,
    }),
    'already_accepted'
  );
});

test('you cannot invite yourself', () => {
  assert.equal(
    inviteAcceptOutcome({ invite: live(), existingUser: { id: 10, activated_at: new Date() }, now: NOW }),
    'self_invite'
  );
});

test('a token that matches nothing is simply not found', () => {
  assert.equal(inviteAcceptOutcome({ invite: null, existingUser: null, now: NOW }), 'not_found');
});

test('an invitation lasts 24 hours and the plain token is never the stored one', () => {
  const { token, tokenHash, expiresAt } = generateInviteToken();
  assert.equal(INVITE_LIFETIME_HOURS, 24);
  assert.notEqual(token, tokenHash);
  assert.equal(hashInviteToken(token), tokenHash);
  assert.match(token, /^[0-9a-f]{64}$/);

  const hours = (expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
  assert.ok(hours > 23.9 && hours <= 24, `expiry was ${hours} hours away`);
});

test('every token is different', () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.tokenHash, b.tokenHash);
});

test('hashing something empty does not throw', () => {
  for (const bad of [null, undefined, '']) assert.match(hashInviteToken(bad), /^[0-9a-f]{64}$/);
});
