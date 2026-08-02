import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptcha, verifyCaptcha } from './captcha.js';

// Guards the public sign-up form. The two failure modes are "bots get through"
// and "a malformed token throws a 500 at a real person".

test('a correct answer verifies', () => {
  const { token, question } = createCaptcha();
  // The question is arithmetic like "7 + 4"; solving it here keeps the test
  // honest about the format actually being solvable.
  const [, a, op, b] = /^\s*(\d+)\s*([+\-x*×])\s*(\d+)/.exec(question) || [];
  assert.ok(a !== undefined, `unexpected question format: ${question}`);
  const answer = op === '+' ? Number(a) + Number(b) : op === '-' ? Number(a) - Number(b) : Number(a) * Number(b);
  assert.equal(verifyCaptcha(token, String(answer)), true);
});

test('a wrong answer fails', () => {
  const { token } = createCaptcha();
  assert.equal(verifyCaptcha(token, '-999'), false);
});

test('a tampered token fails the signature', () => {
  const { token } = createCaptcha();
  const parts = token.split('.');
  parts[parts.length - 1] = 'deadbeef';
  assert.equal(verifyCaptcha(parts.join('.'), '7'), false);
});

test('a malformed token returns false rather than throwing', () => {
  // timingSafeEqual throws on a length mismatch, so the shape has to be
  // checked before it is reached. A 500 on the sign-up form is worse than a
  // rejected captcha.
  for (const bad of ['', 'a', 'a.b', 'a.b.c', 'a.b.c.d.e', '...', null, undefined, 123]) {
    assert.equal(verifyCaptcha(bad, '7'), false, `token ${JSON.stringify(bad)} should fail quietly`);
  }
});

test('a missing answer fails', () => {
  const { token } = createCaptcha();
  assert.equal(verifyCaptcha(token, ''), false);
  assert.equal(verifyCaptcha(token, null), false);
});

test('each captcha is a fresh token', () => {
  assert.notEqual(createCaptcha().token, createCaptcha().token);
});
