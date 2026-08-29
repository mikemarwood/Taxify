import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateReference,
  looksLikeReference,
  statusAfterReply,
  canReply,
  isCategory,
  messageProblem,
  replyProblem,
  subjectProblem,
  hashAccessToken,
  generateAccessToken,
  MAX_BODY,
  isStale,
  isPriority,
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
  // Below the floor now that a message has to say something useful.
  assert.notEqual(messageProblem('Hello'), '');
  assert.equal(messageProblem('The app will not let me sign in at all today'), '');
  assert.notEqual(messageProblem('a'.repeat(MAX_BODY + 1)), '');
});

test('a reply is held to a much lower floor than a first message', () => {
  // The short answers people actually send once a thread is running. Each of
  // these would be refused as a first message, and each is a whole reply.
  assert.equal(replyProblem('Yes please'), '');
  assert.equal(replyProblem('Thanks!'), '');
  assert.equal(replyProblem('Tuesday works'), '');
  assert.equal(replyProblem('Fixed, thank you'), '');

  // Still enough of a floor to catch a stray keypress or an empty box.
  assert.notEqual(replyProblem('   '), '');
  assert.notEqual(replyProblem('k'), '');
  assert.notEqual(replyProblem('ok'), '');

  // The ceiling is the same either way — the same column stores both.
  assert.notEqual(replyProblem('a'.repeat(MAX_BODY + 1)), '');
});

test('a subject has to say something', () => {
  assert.notEqual(subjectProblem('hi'), '');
  assert.equal(subjectProblem('Cannot sign in'), '');
});

test('the guest link is long enough that it cannot be guessed', () => {
  // This link is the whole authority over a conversation — no account behind
  // it, no second factor — so its only defence is that the space cannot be
  // searched.
  const { token } = generateAccessToken();
  assert.ok(token.length >= 60, `token was only ${token.length} characters`);
  // base64url only: safe in a path, and nothing needing escaping that an email
  // client might mangle.
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('two tokens share nothing, and carry no ticket id to work from', () => {
  const a = generateAccessToken().token;
  const b = generateAccessToken().token;
  assert.notEqual(a, b);
  // Holding one says nothing about where another lives.
  assert.equal(a.slice(0, 8) === b.slice(0, 8), false);
});

test('the access token is stored only as a hash', () => {
  // The plain token goes in the email. If the database held it, anybody who
  // could read the table could read every guest conversation.
  const { token, tokenHash } = generateAccessToken();
  assert.notEqual(token, tokenHash);
  assert.equal(hashAccessToken(token), tokenHash);
  assert.equal(tokenHash.length, 64);
});

test('a ticket with us longer than its priority allows is overdue', () => {
  // Not a promise to anybody. It exists so a ticket assigned to somebody on
  // holiday looks neglected instead of merely waiting.
  const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  assert.equal(isStale({ status: 'awaiting_support', priority: 'urgent', lastMessageAt: threeHoursAgo }), false);

  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  assert.equal(isStale({ status: 'awaiting_support', priority: 'urgent', lastMessageAt: sixHoursAgo }), true);
  // The same age is unremarkable for a normal one.
  assert.equal(isStale({ status: 'awaiting_support', priority: 'normal', lastMessageAt: sixHoursAgo }), false);
});

test('a ticket waiting on the customer is never overdue on us', () => {
  // We are not late for an answer nobody has given us yet.
  const old = new Date(Date.now() - 300 * 3600 * 1000).toISOString();
  assert.equal(isStale({ status: 'awaiting_customer', priority: 'urgent', lastMessageAt: old }), false);
  assert.equal(isStale({ status: 'closed', priority: 'urgent', lastMessageAt: old }), false);
});

test('only known priorities are accepted', () => {
  assert.equal(isPriority('urgent'), true);
  assert.equal(isPriority('normal'), true);
  assert.equal(isPriority('whenever'), false);
  assert.equal(isPriority(''), false);
});
