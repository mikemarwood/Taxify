import { useState } from 'react';
import { api } from './api.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

// Moving between plans means two different things depending on where you are.
// With a live subscription the price on it is swapped and Stripe prorates the
// difference; with a trial or a lapsed account there is nothing to swap, so it
// is an ordinary checkout. Callers shouldn't have to know which — hence this.
export function usePlanChange() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function changePlan(planType) {
    if (busy) return;
    if (user?.planType === planType) return;

    const upgrading = planType === 'family';
    const confirmed = window.confirm(
      upgrading
        ? 'Move to the Family plan?\n\nThis adds a second full-access login for someone in your household — you both see the same expenses. If you already pay for Taxify, the difference is charged pro rata from today.'
        : 'Move to the Individual plan?\n\nThe second full-access login must be removed first. If you already pay for Taxify, the difference is credited pro rata.'
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      await api.post('/billing/change-plan', { planType });
      await refresh();
      toast(`You're now on the ${upgrading ? 'Family' : 'Individual'} plan`, 'success');
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
    } finally {
      setBusy(false);
    }
  }

  return { changePlan, busy };
}
