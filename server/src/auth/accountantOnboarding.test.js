import test from 'node:test';
import assert from 'node:assert/strict';
import { accountantSetupState, blocksExistingSession } from './accountantOnboarding.js';

test('somebody who acts for nobody is never gated', () => {
  // The check runs on every authenticated request. If it could ever return
  // "not ready" for an ordinary account holder it would lock the whole app.
  assert.deepEqual(accountantSetupState({ isAccountant: false }), { ready: true, missing: [] });
  assert.deepEqual(accountantSetupState({ isAccountant: false, otpEnabled: false, practiceName: '' }), {
    ready: true,
    missing: [],
  });
  assert.deepEqual(accountantSetupState({}), { ready: true, missing: [] });
});

test('an accountant without two-factor is not ready', () => {
  const state = accountantSetupState({ isAccountant: true, otpEnabled: false, practiceName: 'Chen & Co' });
  assert.equal(state.ready, false);
  assert.deepEqual(state.missing, ['mfa']);
});

test('the site-wide MFA setting satisfies the requirement with no second path', () => {
  // publicUser reports otpEnabled as true whenever mfa_mode is 'required', so
  // an account on a site that already forces MFA has nothing extra to do. If
  // this ever fails, someone has added a parallel notion of "has MFA".
  const state = accountantSetupState({ isAccountant: true, otpEnabled: true, practiceName: 'Chen & Co' });
  assert.deepEqual(state, { ready: true, missing: [] });
});

test('a blank practice name counts as missing, whitespace included', () => {
  for (const blank of ['', '   ', '\t', null, undefined]) {
    const state = accountantSetupState({ isAccountant: true, otpEnabled: true, practiceName: blank });
    assert.deepEqual(state.missing, ['profile'], JSON.stringify(blank));
  }
});

test('both missing reports both, in a stable order', () => {
  const state = accountantSetupState({ isAccountant: true, otpEnabled: false, practiceName: '' });
  assert.equal(state.ready, false);
  // Order is stable so the UI can show the first thing to do without sorting.
  assert.deepEqual(state.missing, ['mfa', 'profile']);
});

test('only two-factor ends a session that is already open', () => {
  // A missing firm name blocks opening new books; it must never throw somebody
  // out of books they are part-way through reading.
  assert.equal(blocksExistingSession({ missing: ['mfa'] }), true);
  assert.equal(blocksExistingSession({ missing: ['mfa', 'profile'] }), true);
  assert.equal(blocksExistingSession({ missing: ['profile'] }), false);
  assert.equal(blocksExistingSession({ missing: [] }), false);
  assert.equal(blocksExistingSession(undefined), false);
});
