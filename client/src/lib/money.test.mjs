import test from 'node:test';
import assert from 'node:assert/strict';
import { amountWhileTyping, amountOnBlur } from './money.js';

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
