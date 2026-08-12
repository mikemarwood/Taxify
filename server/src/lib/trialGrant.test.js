import test from 'node:test';
import assert from 'node:assert/strict';
import { trialDecision, TRIAL_DAYS } from './trialGrant.js';

// The money is the reason this is worth pinning down. A trial that can be had
// twice is a product that is free for anybody willing to click.

test('a first-time account gets the trial', () => {
  const now = Date.UTC(2026, 0, 1);
  const decision = trialDecision({ hasHadTrial: false, isAccountant: false, now });

  assert.equal(decision.grant, true);
  assert.equal(decision.status, 'trialing');
  assert.equal(decision.endsAt.getTime(), now + TRIAL_DAYS * 86400000);
});

test('an account that has already had one never gets another', () => {
  const decision = trialDecision({ hasHadTrial: true });

  assert.equal(decision.grant, false);
  assert.equal(decision.reason, 'already_used');
  assert.equal(decision.endsAt, null);
  // Not 'trialing' with a date in the past, which would read as lapsed and
  // send them to the screen they were trying to leave.
  assert.equal(decision.status, 'none');
});

test('an accountant is not on a trial, first time or not', () => {
  // The point of the accountant state: no plan, so nothing to count down. It
  // outranks having never had one, or every accountant would activate onto a
  // fourteen-day clock they never asked for.
  const fresh = trialDecision({ hasHadTrial: false, isAccountant: true });
  assert.equal(fresh.grant, false);
  assert.equal(fresh.reason, 'accountant');
  assert.equal(fresh.status, 'none');

  assert.equal(trialDecision({ hasHadTrial: true, isAccountant: true }).grant, false);
});

test('the loop this exists to close', () => {
  // Trial, lapse, step down to accountant, add a plan again. The step down
  // leaves trial_ends_at alone, so the second time round grants nothing.
  const first = trialDecision({ hasHadTrial: false });
  assert.equal(first.grant, true);

  const asAccountant = trialDecision({ hasHadTrial: true, isAccountant: true });
  assert.equal(asAccountant.grant, false);

  const backAgain = trialDecision({ hasHadTrial: true, isAccountant: false });
  assert.equal(backAgain.grant, false);
});
