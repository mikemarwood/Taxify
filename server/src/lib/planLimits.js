// How many sets of books a plan allows.
//
// The plan tier is a cap on entities and nothing else. Individual is one
// person's own tax and no businesses; Small Business adds up to two. Exactly one
// Individual either way — an account is one person, and a person has one
// personal return.
//
// Pure, so the rule can be tested without a database and so there is one
// statement of it rather than a check in the route and a different sentence in
// the marketing.

export const PLANS = ['individual', 'business'];

export const PLAN_LIMITS = {
  individual: { businesses: 0, label: 'Individual' },
  business: { businesses: 2, label: 'Small Business' },
};

// Anything unrecognised gets the *smallest* allowance, never the largest.
// plan_type is a free VARCHAR with no constraint, so a typo or a half-finished
// rename must not be a way to grant more than was paid for.
export function entityAllowance(planType) {
  return PLAN_LIMITS[String(planType || '')] || PLAN_LIMITS.individual;
}

export function planLabel(planType) {
  return entityAllowance(planType).label;
}

// Whether another set of books may be created.
//
// `existing` is the account's current entities — pass them all, archived
// included. An archived business still occupies its place: unarchiving is one
// click, and a cap you can step around by archiving and creating is not a cap.
export function canAddEntity({ planType, kind, existing = [] }) {
  if (kind === 'individual') {
    // Not a matter of the plan. One personal return per account on every tier,
    // which is what stops an account becoming two people wearing one login —
    // the thing the Family plan tried to be and could not.
    const already = existing.some((e) => e.kind === 'individual');
    return already
      ? { ok: false, reason: 'one_individual', message: 'An account has one individual return, and yours already has it.' }
      : { ok: true };
  }

  const allowed = entityAllowance(planType).businesses;
  const used = existing.filter((e) => e.kind === 'business').length;

  if (used >= allowed) {
    return {
      ok: false,
      reason: allowed === 0 ? 'plan_required' : 'limit_reached',
      needsPlan: allowed === 0 ? 'business' : null,
      message:
        allowed === 0
          ? 'The Individual plan covers your own tax. Move to Small Business to add a business.'
          : `Small Business covers up to ${allowed} businesses, and you have ${used}.`,
    };
  }

  return { ok: true, remaining: allowed - used - 1 };
}
