import { useState } from 'react';
import { api } from './api.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { currentPlanType, planLabel } from './plans.js';

// Moving between plans means two different things depending on where you are.
// With a live subscription the price on it is swapped and Stripe prorates the
// difference; with a trial or a lapsed account there is nothing to swap, so it
// is an ordinary checkout. Callers shouldn't have to know which — hence this.
//
// The confirmation is a dialog rather than window.confirm because it has a
// figure in it that has to be fetched. It used to be a confirm() that talked
// about removing a second full-access login, which has not existed since the
// Family plan went, and that quoted no price at all — it said "pro rata" and
// left somebody to guess what that meant in dollars.
//
// The dialog comes back as JSX for the caller to render, so the hook stays a
// hook and nothing needs a provider.
export function usePlanChange() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);

  function changePlan(planType) {
    if (busy) return;
    if (currentPlanType(user) === planType) return;
    setPending(planType);
  }

  async function confirmChange() {
    const planType = pending;
    if (!planType || busy) return;

    setBusy(true);
    try {
      await api.post('/billing/change-plan', { planType });
      await refresh();
      setPending(null);
      toast(`You're now on the ${planLabel(planType)} plan`, 'success');
    } catch (err) {
      // Nothing live to change — send them through checkout on the plan they
      // picked instead of telling them to contact support.
      if (err.message === 'no_subscription') {
        try {
          const res = await api.post('/billing/checkout', { planType });
          window.location.href = res.data.url;
          return;
        } catch (checkoutErr) {
          toast(checkoutErr.message, 'error');
        }
      } else {
        toast(err.message, 'error');
      }
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return { changePlan, busy, pending, confirmChange, cancelChange: () => !busy && setPending(null) };
}
