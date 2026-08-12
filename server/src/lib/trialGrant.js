// Who gets a free trial, and when.
//
// Pure, and in its own file, for the same reason planLimits and planRequests
// are: this one decides whether somebody gets fourteen days of the product for
// nothing, and a rule about money is worth being able to test without a
// database.
//
// Two things have to be true. An account only ever gets one trial, and an
// account with no books of its own is not on one at all.

export const TRIAL_DAYS = 14;

// `hasHadTrial` is whether trial_ends_at is set on the row. Nothing clears it
// — not stepping down to an accountant, not lapsing — so it is a permanent
// record that this account has had its fourteen days.
//
// Without that rule, and with a way to step down to an accountant and back,
// the product is free for ever: let it lapse, step down, add a plan, fourteen
// more days, repeat.
export function trialDecision({ hasHadTrial = false, isAccountant = false, now = Date.now() } = {}) {
  if (isAccountant) {
    return { grant: false, reason: 'accountant', endsAt: null, status: 'none' };
  }
  if (hasHadTrial) {
    return { grant: false, reason: 'already_used', endsAt: null, status: 'none' };
  }
  return {
    grant: true,
    reason: 'first_time',
    endsAt: new Date(now + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    status: 'trialing',
  };
}
