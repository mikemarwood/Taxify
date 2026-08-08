import { useEffect } from 'react';

// Stops the page behind a modal from scrolling while it is open.
//
// Without this, a flick anywhere outside the box scrolls the page underneath —
// so somebody closes an expense and finds themselves somewhere else entirely,
// having lost the row they were working through. On a phone it is worse: the
// modal itself often needs to scroll, and the moment it reaches its end the
// gesture is handed to the page behind it, which then moves instead.
//
// The previous value is restored rather than assumed to be empty, so two
// overlays open at once — a confirmation over a modal, which happens on every
// delete — cannot leave the page permanently locked when the inner one closes.
export function useLockBodyScroll(active) {
  useEffect(() => {
    if (!active) return undefined;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

export default useLockBodyScroll;
