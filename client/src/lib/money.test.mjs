import test from 'node:test';
import assert from 'node:assert/strict';
import { amountWhileTyping, amountOnBlur, parseAmount, formatAmountInput } from './money.js';

test('an amount cannot be typed with more than two decimal places', () => {
  // The bug this exists for: type="number" with step="0.01" is a hint to the
  // spinner, not a rule. 32.239 went in, and what got stored was not what was
  // typed.
  assert.equal(amountWhileTyping('32.239'), '32.23');
  assert.equal(amountWhileTyping('32.2'), '32.2');
});

test('a second decimal point is a slip, not a separator', () => {
  assert.equal(amountWhileTyping('32.2.3'), '32.23');
});

test('letters and symbols never reach the field', () => {
  assert.equal(amountWhileTyping('$32.20abc'), '32.20');
});

test('half-typed values are left alone', () => {
  // Fighting somebody mid-keystroke is worse than a moment of invalid text.
  assert.equal(amountWhileTyping(''), '');
  assert.equal(amountWhileTyping('32.'), '32.');
});

test('leaving the field settles it to two places', () => {
  assert.equal(amountOnBlur('32.2'), '32.20');
  assert.equal(amountOnBlur('32.'), '32.00');
  assert.equal(amountOnBlur('32'), '32.00');
});

test('an empty field stays empty', () => {
  // Filling it with 0.00 puts a number in front of somebody that they never
  // entered, and which the form would then accept.
  assert.equal(amountOnBlur(''), '');
  assert.equal(amountOnBlur('   '), '');
});

test('leaving a field groups the thousands', () => {
  assert.equal(amountOnBlur('3350'), '3,350.00');
  assert.equal(amountOnBlur('1234567.5'), '1,234,567.50');
  assert.equal(amountOnBlur('999'), '999.00');
});

test('a grouped value can be parsed back to a number', () => {
  // Number('3,350.00') is NaN. Anything sending a field to the server has to
  // come through here, or the form quietly posts NaN.
  assert.equal(parseAmount('3,350.00'), 3350);
  assert.equal(parseAmount('1,234,567.50'), 1234567.5);
  assert.equal(parseAmount('42'), 42);
});

test('an empty or unreadable amount parses to null, not zero', () => {
  // Zero is a number somebody might have meant. Null is the absence of one,
  // and a form that treats "nothing typed" as "$0.00" will happily submit it.
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('   '), null);
  assert.equal(parseAmount('abc'), null);
});

test('an already grouped value survives being edited in place', () => {
  // The field shows "3,350.00", so whatever is typed into it next arrives with
  // the commas still there. They are stripped and reapplied rather than
  // trusted, so a comma left in the wrong place by an edit does not persist.
  assert.equal(amountWhileTyping('3,350.00'), '3,350.00');
  assert.equal(amountWhileTyping('3,3,5,0'), '3,350');
  assert.equal(amountOnBlur('3,350.005'), '3,350.01');
});

test('grouping is applied while typing', () => {
  // This used to assert the opposite, and the reason it gave was sound at the
  // time: inserting a separator changes the length of the text, and a
  // controlled input whose length changes under the cursor throws the caret to
  // the end — so correcting the third digit of a long number was impossible.
  //
  // onCasedInput now anchors the caret on the count of digits before it rather
  // than on a character offset, which is what makes a length-changing
  // transform safe in a live field. Both amount inputs go through it. The
  // keystroke-by-keystroke proof is in casedInput.test.mjs; this only checks
  // the transform itself.
  assert.equal(amountWhileTyping('3350'), '3,350');
  assert.equal(amountWhileTyping('1234567'), '1,234,567');
  // The fraction is left alone — a comma inside the cents would be nonsense.
  assert.equal(amountWhileTyping('1234.56'), '1,234.56');
  // And a trailing point survives, or the separator is deleted as it is typed
  // and no fraction can ever be entered.
  assert.equal(amountWhileTyping('1234.'), '1,234.');
});
