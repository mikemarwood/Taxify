import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { playInfo } from './sounds.js';

// How many tickets are waiting, for the badges in the navigation.
//
// One poll shared by the whole app rather than one per badge: the sidebar shows
// two of these and the admin queue a third, and three timers asking the same
// question is three times the work for the same answer.
const POLL_MS = 30000;

// Never twice within this. The counts are polled every thirty seconds and a
// busy morning could otherwise chime on every one of them — which is how
// somebody ends up turning sound off entirely and then missing the thing it
// was for.
const QUIET_MS = 5 * 60 * 1000;

export function useSupportCounts({ isAdmin }) {
  const [mine, setMine] = useState(0);
  const [queue, setQueue] = useState(0);
  const lastChime = useRef(0);
  // null until the first answer, so opening the app never chimes for tickets
  // that were already waiting before it was opened.
  const seenMine = useRef(null);
  const seenQueue = useRef(null);

  useEffect(() => {
    let alive = true;

    function chime() {
      const now = Date.now();
      if (now - lastChime.current < QUIET_MS) return;
      lastChime.current = now;
      playInfo();
    }

    async function load() {
      try {
        const res = await api.get('/support/counts');
        if (!alive) return;

        const waitingOnMe = res.data.waitingOnYou || 0;
        setMine(waitingOnMe);
        if (seenMine.current !== null && waitingOnMe > seenMine.current) chime();
        seenMine.current = waitingOnMe;

        if (isAdmin) {
          const needing = res.data.needingReply || 0;
          setQueue(needing);
          if (seenQueue.current !== null && needing > seenQueue.current) chime();
          seenQueue.current = needing;
        }
      } catch {
        // A failed poll is not worth telling anybody about — the number simply
        // stays as it was until the next one.
      }
    }

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isAdmin]);

  return { mine, queue };
}
