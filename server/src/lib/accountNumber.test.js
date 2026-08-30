import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAccountNumber,
} from './accountNumber.js';

test('the whole range is reachable', () => {
  // Off-by-one in randomInt's exclusive upper bound would quietly cost the top
  // value, which is the kind of thing nobody notices for years.
  const seen = new Set();
  for (let i = 0; i < 20000; i += 1) seen.add(Number(generateAccountNumber()));
  const values = [...seen];
  assert.ok(Math.min(...values) >= 10_000_000);
  assert.ok(Math.max(...values) <= 99_999_999);
  // 20,000 draws from 90 million should essentially never repeat.
  assert.ok(seen.size > 19_900, `only ${seen.size} distinct`);
});

