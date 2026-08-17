// Typing into a field that corrects its own capitals, without the caret
// jumping to the end.
//
// The fields that capitalise as you type do it by transforming the value in
// onChange and setting state with the result. When that result differs from
// what is in the box, React writes the new string into the input — and setting
// an input's value parks the caret at the end of it. Type at the end and you
// never notice, because that is where the caret already was. Go back and fix a
// word in the middle and the next keystroke lands at the end of the line
// instead, which is baffling and makes the field feel broken.
//
// The comment on sentenceCaseLive said this could not happen because the
// transform never changes the string's length. Length was the wrong thing to
// worry about: the caret moves because the value was *written*, whether or not
// it got longer.
//
// So the position is taken before the change and put back after React has
// written. Only when the transform actually changed something — if the string
// came back identical, React writes nothing and there is nothing to repair.
export function onCasedInput(transform, setValue) {
  return (event) => {
    const el = event.target;
    const typed = el.value;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    const next = transform(typed);
    setValue(next);

    if (next === typed || start === null) return;

    // After the browser has painted React's write. A microtask is too early —
    // React has not committed yet — and anything later is visible as a jump.
    requestAnimationFrame(() => {
      // Only if nothing else has moved it in the meantime: the field may have
      // been blurred, or the caret deliberately moved, between the keystroke
      // and this running.
      if (document.activeElement !== el) return;
      try {
        el.setSelectionRange(start, end);
      } catch {
        // Some input types refuse a selection range (email, number). Nothing to
        // repair on those, and throwing here would break the keystroke itself.
      }
    });
  };
}
