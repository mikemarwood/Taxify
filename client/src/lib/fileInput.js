// How to hide a file input you intend to click from code.
//
// The obvious way is `hidden`, which is `display: none`, and it works
// everywhere except the one place it matters: Safari on iOS will not open a
// picker — let alone the camera — for a .click() on an element that is not
// rendered. It does nothing at all. No picker, no camera, no error, no console
// message. The button simply appears broken, which is exactly how "Take photo"
// appeared on an iPhone.
//
// So the input stays rendered and goes off-screen instead. Clipped to a pixel
// rather than merely transparent so it cannot be tabbed to or read out — the
// button that triggers it is the thing anybody should reach.
//
// Pair it with tabIndex={-1} and aria-hidden="true" at the call site, and put
// it inside something with `position: relative` so the absolute placement is
// contained.
//
// This does not apply to an input inside a <label>: that is opened by a real
// click on the label, which Safari is perfectly happy about. Only the
// click-it-from-code case needs this.
export const OFF_SCREEN_INPUT = {
  position: 'absolute',
  width: 1,
  height: 1,
  top: 0,
  left: 0,
  opacity: 0,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
};
