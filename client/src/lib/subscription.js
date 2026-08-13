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

  // Acting for clients, with no books of their own.
  //
  // Checked before anything about subscriptions, because an accountant has no
  // subscription by design — and without this they fall through every branch
  // below to the last one and are labelled Expired. Nothing has expired. They
  // are not paying because there is nothing to pay for, which is a perfectly
  // good state to be in and reads as a fault only if we call it one.
  //
  // Neutral, not good: it is a statement of what the account is, not a
  // reassurance about it.
  if (user.role === 'accountant') {
    return {
      state: 'accountant',
      label: 'Accountant',
      detail: 'Acting for clients — no plan needed',
      daysLeft: null,
      tone: 'neutral',
    };
  }

  // An admin-granted account isn't on a trial or a subscription and shouldn't
  // be told it's about to lose access.
  if (user.accessBypass) {
    const until = user.accessBypassUntil ? daysUntil(user.accessBypassUntil) : null;
    return {
      state: 'granted',
      label: 'Active',
      detail: until === null ? 'Your account is active' : `Active · ${until} day${until === 1 ? '' : 's'} left`,
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
    // A year paid outright renews nothing. Telling somebody it renews when it
    // does not is how they lose access on a day they were not expecting, so
    // the two are described as what they are.
    const renews = user.autoRenews !== false;

    if (!renews) {
      return {
        state: 'active',
        label: 'Paid',
        detail: left === null ? 'Paid up' : `Ends in ${left} day${left === 1 ? '' : 's'} — renew to keep going`,
        daysLeft: left,
        // Worth flagging as it gets close, because nothing will happen unless
        // they act.
        tone: left !== null && left <= 14 ? 'warn' : 'good',
      };
    }

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
