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
// How many letters and digits sit before this point, ignoring everything the
// transform might have inserted or moved around them.
//
// This is the anchor for a transform that changes the string's length. A
// character offset is meaningless across such a change; "the caret was after
// the fourth digit" survives it.
function significantBefore(text, index) {
  let count = 0;
  for (let i = 0; i < index; i++) if (/[a-z0-9]/i.test(text[i])) count++;
  return count;
}

// The inverse: the offset just past the nth letter-or-digit.
function offsetAfter(text, count) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[a-z0-9]/i.test(text[i])) continue;
    if (++seen === count) return i + 1;
  }
  return text.length;
}

export function onCasedInput(transform, setValue) {
  return (event) => {
    const el = event.target;
    const typed = el.value;
    let start = el.selectionStart;
    let end = el.selectionEnd;

    const next = transform(typed);
    setValue(next);

    if (next === typed || start === null) return;

    // A transform that changed the length has moved every character after the
    // point of insertion, so the old offset now points somewhere else.
    //
    // This is what put 200,500 into the odometer as 200,005. kmWhileTyping
    // adds thousands separators, so at "2,005" the caret was restored to
    // offset 4 — which is no longer after the "5", it is in front of it. Every
    // digit after that was typed into the middle of the number.
    //
    // Only when the length actually changed. A capitalising transform returns
    // the same length and the same characters in the same places, and the raw
    // offset is exactly right for it — including when the caret is sitting
    // after a space, which counting letters alone would not preserve.
    if (next.length !== typed.length) {
      const collapsed = end === start;
      start = offsetAfter(next, significantBefore(typed, start));
      end = collapsed ? start : offsetAfter(next, significantBefore(typed, end));
    }

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
