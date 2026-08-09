import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Anything about money that is waiting on this account.
//
// One poll for the whole app: the badge beside My account and the plan cards
// are asking the same question, and two timers asking it separately is two
// chances to show different answers on the same screen.
//
// Slower than the support poll on purpose. An invoice does not get paid in the
// thirty seconds between ticks, and this runs for every signed-in person.
const POLL_MS = 60000;

export function useBillingAttention({ enabled = true } = {}) {
  const [state, setState] = useState({ count: 0, reasons: [], request: null });
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await api.get('/billing/attention');
      if (alive.current) setState(res.data);
    } catch {
      // A failed poll is not worth saying anything about — the badge stays as
      // it was until the next one.
    }
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(load, POLL_MS);

    // The moment somebody comes back to the tab. Paying an invoice happens in
    // Stripe, in another tab or on a phone — so the first thing that should
    // happen on returning is the app catching up, not a wait of up to a minute
    // looking at a number that is no longer true.
    function onFocus() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  return { ...state, refresh: load };
}
