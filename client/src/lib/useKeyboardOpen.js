import { useEffect, useState } from 'react';

// Whether the on-screen keyboard is up.
//
// There is no API that says so. What there is: on a phone, opening the
// keyboard shrinks the visual viewport while the layout viewport stays put, so
// a large gap between the two means something is covering the screen. Nothing
// else shrinks it by that much.
//
// 160px because a keyboard is 250-350px on any phone worth worrying about,
// while a collapsing address bar is 50-90px — comfortably either side, so
// scrolling a page does not read as typing on it.
const KEYBOARD_MIN_PX = 160;

export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    // Every browser this matters on has it. Desktop Safari and old Android
    // browsers do not, and neither has a keyboard to hide from.
    if (!vv) return undefined;

    function check() {
      setOpen(window.innerHeight - vv.height > KEYBOARD_MIN_PX);
    }

    check();
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);

  return open;
}
