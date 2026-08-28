import test from 'node:test';
import assert from 'node:assert/strict';
import { onCasedInput } from './casedInput.js';
import { kmWhileTyping } from './deductionInput.js';
import { titleCaseLive } from './textCase.js';
import { amountWhileTyping } from './money.js';

// A stand-in for a text input, enough of one for the caret logic.
//
// The real handler repairs the caret inside requestAnimationFrame, which does
// not exist here — so it is provided, and run synchronously. That is the same
// order of events the browser produces: React writes, then the frame callback
// puts the caret back.
function field(initial = '') {
  const el = {
    value: initial,
    selectionStart: initial.length,
    selectionEnd: initial.length,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  return el;
}

// Types a string one key at a time through the handler, the way a person does.
// This is the only way to catch the bug: every individual keystroke was
// handled correctly, and the number still came out wrong, because the caret
// each one left behind was where the next one landed.
function typeInto(transform, keys, initial = '') {
  const el = field(initial);
  const frames = [];
  const priorRaf = globalThis.requestAnimationFrame;
  const priorDoc = globalThis.document;
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.document = { activeElement: el };

  try {
    const handler = onCasedInput(transform, (next) => {
      // What React does with the new state. The caret only moves when the
      // string actually differs from what is in the box — React compares
      // before it writes, and an unchanged value never touches the DOM.
      if (next === el.value) return;
      el.value = next;
      el.selectionStart = next.length;
      el.selectionEnd = next.length;
    });

    for (const key of keys) {
      const caret = el.selectionStart;
      el.value = el.value.slice(0, caret) + key + el.value.slice(caret);
      el.selectionStart = caret + 1;
      el.selectionEnd = caret + 1;
      handler({ target: el });
      while (frames.length) frames.shift()();
    }
  } finally {
    globalThis.requestAnimationFrame = priorRaf;
    globalThis.document = priorDoc;
  }

  return el.value;
}

test('an odometer reading types out as the digits that were pressed', () => {
  // 200500 came out as 200,005. kmWhileTyping inserts a thousands separator,
  // so at "2,005" the caret was restored to its old offset of 4 — which is no
  // longer after the 5, it is in front of it. Every later digit went into the
  // middle of the number, and the trip claimed a distance nobody drove.
  assert.equal(typeInto(kmWhileTyping, '200500'), '200,500');
});

test('readings on either side of a separator boundary are unharmed', () => {
  assert.equal(typeInto(kmWhileTyping, '999'), '999');
  assert.equal(typeInto(kmWhileTyping, '1000'), '1,000');
  assert.equal(typeInto(kmWhileTyping, '41200'), '41,200');
  assert.equal(typeInto(kmWhileTyping, '1234567'), '1,234,567');
});

test('a capitalising transform still leaves the caret where it was', () => {
  // The case this function was written for, and the reason the length check
  // guards the new behaviour: these transforms do not change the length, and
  // the raw offset is exactly right for them — including after a space, which
  // counting letters alone would not preserve.
  const el = field('hello world');
  el.selectionStart = 6;
  el.selectionEnd = 6;

  const frames = [];
  const priorRaf = globalThis.requestAnimationFrame;
  const priorDoc = globalThis.document;
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.document = { activeElement: el };
  try {
    onCasedInput(titleCaseLive, (next) => {
      if (next === el.value) return;
      el.value = next;
      el.selectionStart = next.length;
      el.selectionEnd = next.length;
    })({ target: el });
    while (frames.length) frames.shift()();
  } finally {
    globalThis.requestAnimationFrame = priorRaf;
    globalThis.document = priorDoc;
  }

  assert.equal(el.value, 'Hello World');
  assert.equal(el.selectionStart, 6, 'the caret stayed after the space');
});

test('editing in the middle of a formatted number keeps the caret there', () => {
  // Put the caret between the 4 and the 1 of "41,200" and type a 9. The digit
  // belongs where it was typed, and the caret belongs after it.
  const el = field('41,200');
  el.selectionStart = 1;
  el.selectionEnd = 1;

  const frames = [];
  const priorRaf = globalThis.requestAnimationFrame;
  const priorDoc = globalThis.document;
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.document = { activeElement: el };
  try {
    const handler = onCasedInput(kmWhileTyping, (next) => {
      if (next === el.value) return;
      el.value = next;
      el.selectionStart = next.length;
      el.selectionEnd = next.length;
    });
    el.value = '491,200';
    el.selectionStart = 2;
    el.selectionEnd = 2;
    handler({ target: el });
    while (frames.length) frames.shift()();
  } finally {
    globalThis.requestAnimationFrame = priorRaf;
    globalThis.document = priorDoc;
  }

  assert.equal(el.value, '491,200');
  assert.equal(el.selectionStart, 2, 'the caret stayed after the digit just typed');
});

test('an amount groups itself as it is typed', () => {
  // Same class of bug as the odometer, and the reason this transform had to be
  // moved onto onCasedInput at the same time as it learned to group: inserting
  // a comma changes the string's length, so a caret restored to its old offset
  // ends up in front of the digit it was behind.
  assert.equal(typeInto(amountWhileTyping, '2000'), '2,000');
  assert.equal(typeInto(amountWhileTyping, '1234567'), '1,234,567');
  assert.equal(typeInto(amountWhileTyping, '999'), '999');
});

test('the decimal part is never grouped, and the point can be typed', () => {
  // A trailing point has to survive keystroke by keystroke or the separator is
  // deleted the moment it is pressed and no fraction can ever be entered.
  assert.equal(typeInto(amountWhileTyping, '2000.50'), '2,000.50');
  assert.equal(typeInto(amountWhileTyping, '1000000.55'), '1,000,000.55');
  assert.equal(typeInto(amountWhileTyping, '0.99'), '0.99');
});

test('a second point is a slip, not a second separator', () => {
  assert.equal(typeInto(amountWhileTyping, '12.3.4'), '12.34');
});

test('cents are capped at two while typing', () => {
  assert.equal(typeInto(amountWhileTyping, '5.999'), '5.99');
});
