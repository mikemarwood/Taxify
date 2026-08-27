import test from 'node:test';
import assert from 'node:assert/strict';
import { pseudonymFor, pseudonymHue, seedForTicket, maskTicket, maskMessage } from './supportIdentity.js';

test('the same person reads as the same pseudonym every time', () => {
  // The property support actually needs from a name: recognising that this is
  // the person who wrote last week, without being told who they are.
  assert.equal(pseudonymFor('u42'), pseudonymFor('u42'));
  assert.notEqual(pseudonymFor('u42'), pseudonymFor('u43'));
});

test('a pseudonym can be read down a phone', () => {
  // No 0/O or 1/I, because these get quoted aloud between staff.
  for (const seed of ['u1', 'u2', 'u999', 't7', 'guest']) {
    const label = pseudonymFor(seed);
    assert.match(label, /^Customer [A-Z2-9]{4}$/, label);
    assert.ok(!/[01OI]/.test(label.slice(9)), label);
  }
});

test('nothing identifying survives masking a ticket', () => {
  const shaped = {
    id: 9,
    reference: 'TX-1234',
    subject: 'Export failed',
    who: 'Jane Smith',
    email: 'jane@example.com',
    avatarUrl: '/api/auth/avatar/42',
    status: 'awaiting_support',
  };
  const masked = maskTicket(shaped, 'u42');

  assert.ok(!('email' in masked), 'the address is gone, not blanked');
  assert.ok(!('avatarUrl' in masked), 'the face is gone, not blanked');
  assert.equal(masked.who, pseudonymFor('u42'));
  assert.equal(masked.identityHidden, true);

  // Everything the queue needs to do its job is untouched.
  assert.equal(masked.subject, 'Export failed');
  assert.equal(masked.reference, 'TX-1234');
  assert.equal(masked.status, 'awaiting_support');

  // And the original is not mutated — the caller may still need it to send an
  // email about the very ticket it just masked for display.
  assert.equal(shaped.email, 'jane@example.com');
});

test('deleted rather than blanked, so a missed mask shows up as a name', () => {
  // An empty string still says there was a field there, and a later change
  // that forgets to mask would look like a blank quietly filling in rather
  // than like a name appearing where none should be.
  const masked = maskTicket({ who: 'Jane', email: 'j@e.com', avatarUrl: '/x' }, 'u1');
  assert.equal(Object.prototype.hasOwnProperty.call(masked, 'email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(masked, 'avatarUrl'), false);
});

test('only the customer is masked in a thread', () => {
  // A reply from support is signed by whoever wrote it. Hiding staff from each
  // other would break a handover and protect nobody who needs protecting.
  const fromStaff = { role: 'support', name: 'Mike', avatarUrl: '/api/auth/avatar/1' };
  assert.deepEqual(maskMessage(fromStaff, 'u42'), fromStaff);

  const note = { role: 'note', name: 'Mike' };
  assert.deepEqual(maskMessage(note, 'u42'), note);

  const fromCustomer = { role: 'customer', name: 'Jane Smith', avatarUrl: '/api/auth/avatar/42' };
  const masked = maskMessage(fromCustomer, 'u42');
  assert.equal(masked.name, pseudonymFor('u42'));
  assert.ok(!('avatarUrl' in masked));
});

test('a signed-in customer keeps one pseudonym across their tickets', () => {
  const first = seedForTicket({ id: 1, user_id: 42 });
  const second = seedForTicket({ id: 99, user_id: 42 });
  assert.equal(first, second);
  assert.equal(pseudonymFor(first), pseudonymFor(second));
});

test('a guest is seeded from the ticket, because there is no account', () => {
  const a = seedForTicket({ id: 7, user_id: null });
  const b = seedForTicket({ id: 8, user_id: null });
  assert.notEqual(a, b);
});

test('the hue is stable and in range', () => {
  for (const seed of ['u1', 'u2', 't3', '']) {
    const hue = pseudonymHue(seed);
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, String(hue));
    assert.equal(hue, pseudonymHue(seed));
  }
});

test('a missing seed does not produce the word undefined on screen', () => {
  assert.equal(pseudonymFor(null), 'Customer');
  assert.equal(pseudonymFor(undefined), 'Customer');
  assert.equal(pseudonymFor(''), 'Customer');
});
