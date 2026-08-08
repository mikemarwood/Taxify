import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceCaseLive, sentenceCase, titleCaseLive, titleCase } from './textCase.js';

test('the first letter is capitalised as it is typed', () => {
  assert.equal(sentenceCaseLive('h'), 'H');
  assert.equal(sentenceCaseLive('hello'), 'Hello');
});

test('a trailing space survives, so a second word can be typed', () => {
  // The bug that makes the trimming version unusable per keystroke: the space
  // is deleted the moment it is typed, and no second word is ever possible.
  assert.equal(sentenceCaseLive('hello '), 'Hello ');
  assert.equal(sentenceCaseLive('hello w'), 'Hello w');
});

test('the length never changes, so the caret cannot jump', () => {
  // Only case is touched. Inserting or removing a character would send the
  // cursor to the end of the box mid-sentence.
  for (const input of ['hello there', 'a. b. c', '  spaced  out  ', 'one\n\ntwo', '']) {
    assert.equal(sentenceCaseLive(input).length, input.length, `changed length for ${JSON.stringify(input)}`);
  }
});

test('a new sentence after a full stop is capitalised', () => {
  assert.equal(sentenceCaseLive('one thing. another thing'), 'One thing. Another thing');
  assert.equal(sentenceCaseLive('why? because'), 'Why? Because');
});

test('a new line starts a sentence, because that is how paragraphs work', () => {
  assert.equal(sentenceCaseLive('first para\nsecond para'), 'First para\nSecond para');
  assert.equal(sentenceCaseLive('first\n\nsecond'), 'First\n\nSecond');
});

test('a blank line between paragraphs survives typing', () => {
  // sentenceCase collapses this to a single space, so a textarea using it per
  // keystroke could never be given two paragraphs.
  assert.equal(sentenceCaseLive('one\n\n'), 'One\n\n');
  assert.equal(sentenceCase('one\n\ntwo'), 'One two');
});

test('a decimal point does not start a new sentence', () => {
  // No space after the stop, so nothing to capitalise — "32.50 spent" must not
  // become "32.50 Spent".
  assert.equal(sentenceCaseLive('it cost 32.50 today'), 'It cost 32.50 today');
});

test('deliberate capitals in the middle of a sentence are left alone', () => {
  assert.equal(sentenceCaseLive('the ATO said so'), 'The ATO said so');
  assert.equal(sentenceCaseLive('spoke to McDonald about it'), 'Spoke to McDonald about it');
});

test('titleCaseLive keeps the same promise about spaces', () => {
  assert.equal(titleCaseLive('mikes '), 'Mikes ');
  assert.equal(titleCase('  mikes   books  '), 'Mikes Books');
});
