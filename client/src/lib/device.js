// Whether a field should take focus on its own when a page opens.
//
// On a desktop that is a courtesy: the cursor is already where you were going.
// On a phone it summons the keyboard before anybody has decided to type, which
// covers half the screen and pushes the thing they were reading out of view.
//
// Checked once at module load rather than per render: a device does not stop
// having a touchscreen while somebody is filling in a form.
const coarsePointer =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

export const autoFocusFields = !coarsePointer;
