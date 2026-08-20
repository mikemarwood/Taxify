import { useEffect, useState } from 'react';

// How long is left to answer an invitation, counted down in front of you.
//
// A date on its own — "expires 3 September" — does not tell somebody whether
// they have a fortnight or an afternoon, and this is a decision people put off.
// The clock is the useful form of the same fact.
//
// The step changes with what is left: days while there are days, then hours,
// then minutes, and seconds only in the last five. A page that ticks once a
// second all day is a page that re-renders eighty-six thousand times to say
// nothing, and the seconds do not matter until they nearly do.
function parts(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function tickFor(msLeft) {
  if (msLeft <= 5 * 60 * 1000) return 1000;
  if (msLeft <= 60 * 60 * 1000) return 15 * 1000;
  return 60 * 1000;
}

export default function InviteCountdown({ expiresAt, onExpired }) {
  const target = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => target - Date.now());

  useEffect(() => {
    if (left <= 0) return undefined;
    const id = setTimeout(() => setLeft(target - Date.now()), tickFor(left));
    return () => clearTimeout(id);
  }, [left, target]);

  // Said once, on the way past zero, so the page can drop the card rather than
  // leave a dead one on screen. The server has swept it by then or will within
  // the quarter hour; this is only what the person looking at it sees.
  useEffect(() => {
    if (left <= 0) onExpired?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left <= 0]);

  if (!Number.isFinite(target)) return null;

  if (left <= 0) {
    return <span style={{ color: 'var(--red)', fontWeight: 700 }}>Expired</span>;
  }

  const { days, hours, minutes, seconds } = parts(left);
  const urgent = left <= 60 * 60 * 1000;

  const text =
    days > 0
      ? `${days}d ${hours}h left`
      : hours > 0
      ? `${hours}h ${minutes}m left`
      : minutes > 0
      ? `${minutes}m ${String(seconds).padStart(2, '0')}s left`
      : `${seconds}s left`;

  return (
    <span
      // Polite rather than assertive: it changes constantly and is not worth
      // interrupting a screen reader mid-sentence for.
      aria-live="polite"
      style={{
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: urgent ? 'var(--red)' : 'var(--text-muted)',
      }}
    >
      {text}
    </span>
  );
}
