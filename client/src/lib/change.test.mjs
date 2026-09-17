import test from 'node:test';
import assert from 'node:assert/strict';
import { changeBetween, formatChange, directionOf } from './change.js';

test('a period with nothing before it has no percentage', () => {
  // The one that matters. A first month has no previous month, and "+100%"
  // against zero is a trend invented from a single data point.
  assert.equal(changeBetween(452.82, 0), null);
  assert.equal(changeBetween(0, 0), null);
  assert.equal(changeBetween(10, null), null);
  assert.equal(changeBetween(10, undefined), null);
});

test('the percentage is against the earlier figure', () => {
  assert.equal(changeBetween(112, 100), 12);
  assert.equal(changeBetween(88, 100), -12);
  assert.equal(changeBetween(100, 100), 0);
});

test('one decimal place, so a tile is not six digits wide', () => {
  assert.equal(changeBetween(101.234, 100), 1.2);
  assert.equal(changeBetween(200, 3), 6566.7);
});

test('falling to nothing is minus a hundred, not a null', () => {
  // There was something before and there is nothing now. That is a real
  // movement and the tile should say so.
  assert.equal(changeBetween(0, 250), -100);
});

test('formatted with a sign, and a real minus', () => {
  assert.equal(formatChange(12), '+12%');
  assert.equal(formatChange(-8), '−8%');
  assert.equal(formatChange(0), '0%');
  assert.equal(formatChange(12.4), '+12%');
  assert.equal(formatChange(12.5), '+13%');
});

test('nothing to format when there was nothing to compare', () => {
  assert.equal(formatChange(null), null);
  assert.equal(formatChange(undefined), null);
  assert.equal(formatChange(Number.NaN), null);
  assert.equal(formatChange(Number.POSITIVE_INFINITY), null);
});

test('direction drives the arrow and the colour', () => {
  assert.equal(directionOf(12), 'up');
  assert.equal(directionOf(-8), 'down');
  assert.equal(directionOf(0), 'flat');
  // Rounds first, so a tile never shows "0%" beside a green upward arrow.
  assert.equal(directionOf(0.2), 'flat');
  assert.equal(directionOf(null), null);
});
