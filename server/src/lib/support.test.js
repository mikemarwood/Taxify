import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateReference,
  looksLikeReference,
  statusAfterReply,
  canReply,
  isCategory,
  messageProblem,
  subjectProblem,
  hashAccessToken,
  generateAccessToken,
  MAX_BODY,
} from './support.js';

test('a reference is not the row id', () => {
  // "Ticket 3" tells the customer they are the third person ever to write in,
  // and tells anybody else how many customers there are.
  const ref = generateReference(new Date('2026-08-08T00:00:00Z'));
  assert.match(ref, /^TXF-2026-[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.equal(looksLikeReference(ref), true);
});

test('two references made together do not look related', () => {
  const a = generateReference();
  const b = generateReference();
  assert.notEqual(a, b);
});

test('a reference never contains a letter that reads as a digit', () => {
  // Crockford's alphabet: no I, L, O or U, so nothing is misread down a phone
  // line or typed back as a one or a zero.
  const refs = Array.from({ length: 200 }, () => generateReference()).join('');
  for (const bad of ['I', 'L', 'O', 'U']) {
    assert.equal(refs.split('-')[2] === undefined ? false : refs.includes(bad), false, `contains ${bad}`);
  }
});

test('replying hands the ticket to the other side', () => {
  assert.equal(statusAfterReply('awaiting_support', 'support'), 'awaiting_customer');
  assert.equal(statusAfterReply('awaiting_customer', 'customer'), 'awaiting_support');
});

test('a closed ticket stays closed when somebody writes', () => {
  // Reopening is a decision, not a side effect of typing — otherwise closing a
  // ticket means nothing.
  assert.equal(statusAfterReply('closed', 'customer'), 'closed');
  assert.equal(statusAfterReply('closed', 'support'), 'closed');
  assert.equal(canReply({ status: 'closed' }), false);
  assert.equal(canReply({ status: 'awaiting_support' }), true);
});

test('only known categories are accepted', () => {
  assert.equal(isCategory('billing'), true);
  assert.equal(isCategory('anything'), false);
  assert.equal(isCategory(''), false);
});

test('an empty message is refused', () => {
  assert.notEqual(messageProblem('   '), '');
  assert.equal(messageProblem('Hello'), '');
  assert.notEqual(messageProblem('a'.repeat(MAX_BODY + 1)), '');
});

test('a subject has to say something', () => {
  assert.notEqual(subjectProblem('hi'), '');
  assert.equal(subjectProblem('Cannot sign in'), '');
});

test('the access token is stored only as a hash', () => {
  // The plain token goes in the email. If the database held it, anybody who
  // could read the table could read every guest conversation.
  const { token, tokenHash } = generateAccessToken();
  assert.notEqual(token, tokenHash);
  assert.equal(hashAccessToken(token), tokenHash);
  assert.equal(tokenHash.length, 64);
});
