import { useEffect, useState } from 'react';

// A scrollbar for the sidebar that is actually there.
//
// The rail scrolls when the screen is short, and on a phone or tablet nothing
// says so. Mobile browsers draw overlay scrollbars: they appear while a finger
// is moving and fade the moment it stops, so a rail with three links below the
// fold looks like a rail with three links missing. The ::-webkit-scrollbar
// rules in theme.css do not help — overlay scrollbars ignore them, which is
// why the note on the rail already says "scrollbar-slim only styles a
// scrollbar; it never made one appear".
//
// So this draws one. It is a hint rather than a control: pointer-events are
// off, because a strip down the edge of a narrow drawer is exactly where a
// thumb lands when somebody means to scroll the rail itself, and swallowing
// that touch would make the problem worse than the one being fixed.
//
// It lives in a sticky, zero-height wrapper. The rail is the scrolling element,
// so an ordinary absolutely-positioned child would scroll away with the
// content it is meant to be describing.
export default function RailScrollbar({ containerRef }) {
  const [box, setBox] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    function measure() {
      const { scrollHeight, clientHeight, scrollTop } = el;
      // A few pixels of slack: sub-pixel layout leaves most elements
      // technically overflowing, and a scrollbar for two pixels is noise.
      if (scrollHeight - clientHeight < 8) return setBox(null);

      // Never smaller than a thumb somebody can see. The proportional height
      // of a very long rail comes out at a few pixels, which reads as a mark
      // on the screen rather than a control.
      const height = Math.max(28, Math.round((clientHeight / scrollHeight) * clientHeight));
      const travel = clientHeight - height;
      const top = Math.round((scrollTop / (scrollHeight - clientHeight)) * travel);
      setBox({ trackHeight: clientHeight, height, top });
    }

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    // Anything that changes what is in the rail changes whether it overflows —
    // a client banner appearing, the plan card growing a trial countdown, the
    // browser's own bars sliding away on a phone.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    window.addEventListener('resize', measure);

    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef]);

  if (!box) return null;

  return (
    <div aria-hidden style={{ position: 'sticky', top: 0, height: 0, zIndex: 6, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: -8,
          width: 4,
          height: box.trackHeight,
          borderRadius: 999,
          background: 'var(--nav-border)',
          opacity: 0.5,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: box.top,
            left: 0,
            width: '100%',
            height: box.height,
            borderRadius: 999,
            background: 'var(--nav-text)',
            opacity: 0.65,
          }}
        />
      </div>
    </div>
  );
}
