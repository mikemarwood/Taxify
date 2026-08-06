import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAccountNumber, isAccountNumber } from './accountNumber.js';

test('always eight digits, never starting with a zero', () => {
  // A leading zero survives here and then vanishes the moment somebody pastes
  // it into a spreadsheet, so the range starts at 10,000,000.
  for (let i = 0; i < 2000; i += 1) {
    const n = generateAccountNumber();
    assert.equal(n.length, 8, `got ${n}`);
    assert.notEqual(n[0], '0', `got ${n}`);
    assert.ok(isAccountNumber(n), `got ${n}`);
  }
});

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

test('isAccountNumber refuses what would look like one but is not', () => {
  assert.equal(isAccountNumber('01234567'), false);
  assert.equal(isAccountNumber('1234567'), false);
  assert.equal(isAccountNumber('123456789'), false);
  assert.equal(isAccountNumber('1234567a'), false);
  assert.equal(isAccountNumber(''), false);
  assert.equal(isAccountNumber(null), false);
  assert.equal(isAccountNumber(12345678), true);
});
