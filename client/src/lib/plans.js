// Which plan an account is on, decided in one place.
//
// plan_type is a free VARCHAR that can be NULL — an account created by an
// admin, one imported, or one whose rename was missed. Everywhere that showed
// a label already coerced NULL to "Individual", but the plan cards compared
// the raw value with ===, so a NULL account was told it was on Individual
// while both cards offered themselves as something to switch to. The two
// answers have to come from the same function or they will disagree again.
//
// This mirrors server/src/lib/planLimits.js, which resolves anything it does
// not recognise to the smallest allowance for the same reason.

export const PLAN_LABELS = {
  individual: 'Individual',
  business: 'Small Business',
};

export function currentPlanType(user) {
  return user?.planType === 'business' ? 'business' : 'individual';
}

export function planLabel(planType) {
  return PLAN_LABELS[planType] || PLAN_LABELS.individual;
}

// Whether this account is actually paying for the plan it is on. Somebody
// whose trial has lapsed is still "on" Individual, but has not bought it —
// which is a different thing to say on a card.
export function hasLiveSubscription(user) {
  return user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing';
}
