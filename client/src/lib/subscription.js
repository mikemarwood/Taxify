// One reading of the subscription state, used by the sidebar, the dashboard
// and the restricted screen. Three places describing the same thing in three
// slightly different ways is how "your trial ends today" and "expired" end up
// on screen together.

const DAY = 24 * 60 * 60 * 1000;

function daysUntil(value) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / DAY);
}

// Returns { state, label, detail, daysLeft, tone } where tone is one of
// 'good' | 'warn' | 'bad' | 'neutral'.
export function describeSubscription(user) {
  if (!user) return { state: 'unknown', label: '', detail: '', daysLeft: null, tone: 'neutral' };

  // An admin-granted account isn't on a trial or a subscription and shouldn't
  // be told it's about to lose access.
  if (user.accessBypass) {
    const until = user.accessBypassUntil ? daysUntil(user.accessBypassUntil) : null;
    return {
      state: 'granted',
      label: 'Access granted',
      detail: until === null ? 'Full access, no subscription needed' : `Granted access · ${until} day${until === 1 ? '' : 's'} left`,
      daysLeft: until,
      tone: 'good',
    };
  }

  if (user.subscriptionStatus === 'trialing') {
    const left = daysUntil(user.trialEndsAt);
    if (left === null) return { state: 'trial', label: 'Free trial', detail: 'Trial active', daysLeft: null, tone: 'good' };
    if (left <= 0) {
      return { state: 'expired', label: 'Trial ended', detail: 'Your free trial has ended', daysLeft: 0, tone: 'bad' };
    }
    return {
      state: 'trial',
      label: `Trial · ${left} day${left === 1 ? '' : 's'} left`,
      detail: `Free trial ends in ${left} day${left === 1 ? '' : 's'}`,
      daysLeft: left,
      // Under a week is worth flagging; before that it's just information.
      tone: left <= 3 ? 'bad' : left <= 7 ? 'warn' : 'good',
    };
  }

  if (user.subscriptionStatus === 'active') {
    const left = daysUntil(user.subscriptionCurrentPeriodEnd);
    return {
      state: 'active',
      label: 'Subscribed',
      detail: left === null ? 'Subscription active' : `Renews in ${left} day${left === 1 ? '' : 's'}`,
      daysLeft: left,
      tone: 'good',
    };
  }

  if (user.subscriptionStatus === 'past_due') {
    return {
      state: 'past_due',
      label: 'Payment failed',
      detail: 'Your last payment failed — update your card to keep access',
      daysLeft: 0,
      tone: 'bad',
    };
  }

  return {
    state: 'expired',
    label: user.subscriptionStatus === 'canceled' ? 'Cancelled' : 'Expired',
    detail:
      user.subscriptionStatus === 'canceled'
        ? 'Your subscription was cancelled'
        : 'Your access has expired',
    daysLeft: 0,
    tone: 'bad',
  };
}

export function toneColor(tone) {
  if (tone === 'good') return 'var(--emerald)';
  if (tone === 'warn') return 'var(--amber)';
  if (tone === 'bad') return 'var(--red)';
  return 'var(--text-muted)';
}
