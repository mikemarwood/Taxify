import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAddEntity,
  entityAllowance,
  planLabel,
  PLAN_LIMITS,
} from './planLimits.js';

const individual = { kind: 'individual' };
const business = { kind: 'business' };

test('Individual covers your own tax and no businesses', () => {
  assert.equal(entityAllowance('individual').businesses, 0);
  const result = canAddEntity({ planType: 'individual', kind: 'business', existing: [individual] });
  assert.equal(result.ok, false);
  assert.equal(result.needsPlan, 'business');
});

test('Small Business allows two, and refuses the third', () => {
  assert.equal(entityAllowance('business').businesses, 2);
  const one = canAddEntity({ planType: 'business', kind: 'business', existing: [individual] });
  assert.equal(one.ok, true);

  const two = canAddEntity({ planType: 'business', kind: 'business', existing: [individual, business] });
  assert.equal(two.ok, true);
  assert.equal(two.remaining, 0);

  const three = canAddEntity({ planType: 'business', kind: 'business', existing: [individual, business, business] });
  assert.equal(three.ok, false);
  assert.equal(three.reason, 'limit_reached');
});

test('an unknown plan gets the smallest allowance, never the largest', () => {
  // plan_type is a free VARCHAR with no constraint. A typo, a half-finished
  // rename, or a value from an older release must not be a way to grant more
  // than was paid for — so the fallback is the floor, not the ceiling.
  for (const bad of ['family', 'FAMILY', 'premium', '', null, undefined, 0, {}]) {
    assert.equal(entityAllowance(bad).businesses, 0, String(bad));
    const result = canAddEntity({ planType: bad, kind: 'business', existing: [] });
    assert.equal(result.ok, false, String(bad));
  }
});

test('one individual return per account, on every plan', () => {
  for (const plan of ['individual', 'business']) {
    const first = canAddEntity({ planType: plan, kind: 'individual', existing: [] });
    assert.equal(first.ok, true, plan);

    const second = canAddEntity({ planType: plan, kind: 'individual', existing: [individual] });
    assert.equal(second.ok, false, plan);
    assert.equal(second.reason, 'one_individual');
  }
});

test('an individual is allowed even when the business cap is full', () => {
  // The two limits are unrelated: the personal return is not one of the two
  // businesses, and an account missing its own should always be able to get it.
  const result = canAddEntity({ planType: 'business', kind: 'individual', existing: [business, business] });
  assert.equal(result.ok, true);
});

test('an archived business still occupies its place', () => {
  // Otherwise the cap is one archive away from meaningless.
  const archived = { kind: 'business', archivedAt: '2026-01-01' };
  const result = canAddEntity({ planType: 'business', kind: 'business', existing: [individual, business, archived] });
  assert.equal(result.ok, false);
});

test('an account already over the cap is refused more, not stripped', () => {
  // Grandfathering is a route concern, but the rule has to say "no more"
  // rather than "you have too many" — nothing existing is ever removed.
  const result = canAddEntity({
    planType: 'business',
    kind: 'business',
    existing: [individual, business, business, business, business],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /you have 4/);
});

test('the plan names are the ones the customer sees', () => {
  assert.equal(planLabel('individual'), 'Individual');
  assert.equal(planLabel('business'), 'Small Business');
  assert.equal(planLabel('family'), 'Individual');
  assert.equal(Object.keys(PLAN_LIMITS).length, 2);
});

test('converting a set of books counts as creating one', () => {
  // The route asks this question by passing every entity *except* the one
  // being changed. On Individual, flipping the only set of books to a business
  // was the whole business feature set for free — and it was two clicks in the
  // UI, not a crafted request.
  const asBusiness = canAddEntity({ planType: 'individual', kind: 'business', existing: [] });
  assert.equal(asBusiness.ok, false);
  assert.equal(asBusiness.needsPlan, 'business');

  // Small Business with both businesses already used has no room to convert a
  // third either.
  assert.equal(
    canAddEntity({ planType: 'business', kind: 'business', existing: [individual, business, business] }).ok,
    false
  );

  // And the same call refuses walking around the one-individual rule from the
  // other side.
  assert.equal(canAddEntity({ planType: 'business', kind: 'individual', existing: [individual] }).ok, false);

  // Converting the second business on Small Business is fine — one sibling.
  assert.equal(canAddEntity({ planType: 'business', kind: 'business', existing: [individual, business] }).ok, true);
});

