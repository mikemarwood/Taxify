import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIENCES,
  BATCH_SIZE,
  MAX_BODY,
  MAX_SUBJECT,
  MIN_BODY,
  MIN_SUBJECT,
  audienceByKey,
  batchesOf,
  broadcastProblem,
  tidyBroadcast,
} from './broadcast.js';

test('every audience is restricted to confirmed accounts', () => {
  // An address that has never been confirmed is an address somebody typed, and
  // may belong to a person who has never heard of us. Sending to it is how a
  // domain ends up on a blocklist, and it takes one complaint.
  for (const audience of AUDIENCES) {
    assert.match(audience.where, /activated_at IS NOT NULL/, audience.key);
    // Owners only: a sub-user did not sign up and did not agree to anything.
    assert.match(audience.where, /role = 'owner'/, audience.key);
  }
});

test('the audiences do not overlap and cover everybody', () => {
  // Paying, trialling and neither are the three states an activated account can
  // be in, so somebody choosing between them cannot accidentally miss a group
  // or mail one twice.
  const paying = audienceByKey('paying').where;
  const trialing = audienceByKey('trialing').where;
  const lapsed = audienceByKey('lapsed').where;

  assert.match(paying, /IN \('active', 'past_due'\)/);
  assert.match(trialing, /= 'trialing'/);
  assert.match(lapsed, /NOT IN \('active', 'past_due', 'trialing'\)/);
});

test('an unknown audience is refused rather than treated as everybody', () => {
  // The failure that matters: a typo in the audience must not fall through to
  // the whole list.
  assert.equal(audienceByKey('nonsense'), null);
  assert.match(broadcastProblem({ audience: 'nonsense', subject: 'Hello there', body: 'x'.repeat(30) }), /Choose who/);
  assert.match(broadcastProblem({ subject: 'Hello there', body: 'x'.repeat(30) }), /Choose who/);
});

test('a message is checked before anything is sent', () => {
  // Per send, not per recipient: what cannot go to the first person cannot go
  // to the four hundredth, and finding out half way leaves a send nobody can
  // safely repeat.
  const ok = { audience: 'all', subject: 'Hello there', body: 'x'.repeat(MIN_BODY) };
  assert.equal(broadcastProblem(ok), null);

  assert.match(broadcastProblem({ ...ok, subject: 'Hi' }), /at least/);
  assert.match(broadcastProblem({ ...ok, subject: 'x'.repeat(MAX_SUBJECT + 1) }), /at most/);
  assert.match(broadcastProblem({ ...ok, body: 'too short' }), /at least/);
  assert.match(broadcastProblem({ ...ok, body: 'x'.repeat(MAX_BODY + 1) }), /at most/);
  // Whitespace is not content.
  assert.match(broadcastProblem({ ...ok, subject: '     ' }), /at least/);
});

test('paragraphs survive the tidying', () => {
  // sentenceCase collapses runs of whitespace, so running it over the whole
  // body would join every paragraph into one block and lose the shape somebody
  // wrote. It is applied paragraph by paragraph instead.
  const { body } = tidyBroadcast({
    subject: 'anything',
    body: 'first line here.\n\nsecond paragraph starts here.\n\nthird one.',
  });
  assert.equal(body.split('\n\n').length, 3);
  assert.match(body, /^First line here\./);
  assert.match(body, /Second paragraph starts here\./);
});

test('the subject and body come out in sentences', () => {
  const { subject, body } = tidyBroadcast({ subject: 'end of year is coming', body: 'get your receipts in. we close friday.' });
  assert.equal(subject, 'End of year is coming');
  assert.equal(body, 'Get your receipts in. We close friday.');
});

test('nothing longer than the limits reaches the mailer', () => {
  const { subject, body } = tidyBroadcast({ subject: 'x'.repeat(500), body: 'y'.repeat(9000) });
  assert.equal(subject.length, MAX_SUBJECT);
  assert.ok(body.length <= MAX_BODY);
});

test('a send is cut into batches with nobody dropped or repeated', () => {
  // The property that matters is not the batch size, it is that flattening the
  // batches gives back exactly the list that went in.
  for (const total of [0, 1, 19, 20, 21, 137]) {
    const people = Array.from({ length: total }, (_, i) => `p${i}`);
    const batches = batchesOf(people);
    assert.deepEqual(batches.flat(), people, `total ${total}`);
    for (const batch of batches) assert.ok(batch.length <= BATCH_SIZE, `total ${total}`);
    if (total) assert.ok(batches.length === Math.ceil(total / BATCH_SIZE));
  }
});

test('an empty audience produces no batches rather than one empty one', () => {
  // A single empty batch would make the sender pause and report progress for a
  // send with nobody in it.
  assert.deepEqual(batchesOf([]), []);
});
