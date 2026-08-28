import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_DISPLAY_NAME, supportDisplayName, maskStaffMessage } from './supportIdentity.js';

test('every reply reaches a customer as the same identity', () => {
  // One name rather than a per-person handle. The customer is dealing with the
  // company, and a name that changes between replies invites the question of
  // who they are speaking to now — which is the question this exists to stop
  // having to answer.
  assert.equal(SUPPORT_DISPLAY_NAME, 'Taxify Support');
  assert.equal(supportDisplayName(), 'Taxify Support');
});

test('the label cannot be talked into revealing part of a name', () => {
  // It takes no argument on purpose: a function that accepted a name and
  // sometimes returned part of it is one somebody will later be tempted to
  // make return a bit more of it.
  assert.equal(supportDisplayName('Mike Marwood'), 'Taxify Support');
  assert.equal(supportDisplayName(''), 'Taxify Support');
  assert.equal(supportDisplayName(null), 'Taxify Support');
});

test('a customer gets the label and nothing behind it', () => {
  const reply = { role: 'support', name: 'Mike Marwood', avatarUrl: '/api/auth/avatar/1', body: 'Try this.' };
  const seen = maskStaffMessage(reply);

  assert.equal(seen.name, 'Taxify Support');
  assert.equal(Object.prototype.hasOwnProperty.call(seen, 'avatarUrl'), false, 'the face goes, it is not blanked');
  assert.equal(Object.prototype.hasOwnProperty.call(seen, 'staffName'), false, 'and no real name travels with it');
  assert.equal(seen.fromSupport, true);
  // What they wrote is untouched. This hides who, never what.
  assert.equal(seen.body, 'Try this.');
  // The original survives, because the same row is used to send email.
  assert.equal(reply.name, 'Mike Marwood');
});

test('staff get the same label with the writer underneath', () => {
  // Both sides read "Taxify Support"; one of them also sees who is behind it.
  // A queue where nobody can tell who answered is a queue where a handover
  // cannot happen and nobody can be asked about their own reply.
  const seen = maskStaffMessage({ role: 'support', name: 'Mike Marwood' }, { staff: true });
  assert.equal(seen.name, 'Taxify Support');
  assert.equal(seen.staffName, 'Mike Marwood');
});

test('an unsigned reply does not produce an empty line', () => {
  const seen = maskStaffMessage({ role: 'support', name: '' }, { staff: true });
  assert.equal(Object.prototype.hasOwnProperty.call(seen, 'staffName'), false);
});

test('the customer is never masked on their own thread', () => {
  // They wrote it. Replacing their own name in their own conversation would be
  // baffling, and it is the reason the first version of this file was wrong.
  const mine = { role: 'customer', name: 'Jane Smith', avatarUrl: '/api/auth/avatar/42' };
  assert.deepEqual(maskStaffMessage(mine, { staff: true }), mine);
});

test('an internal note is passed through untouched', () => {
  // Notes never reach a customer — messagesFor filters them long before this.
  // Masking one would only hide a name from the staff who wrote it for
  // each other.
  const note = { role: 'note', name: 'Mike Marwood' };
  assert.deepEqual(maskStaffMessage(note, { staff: true }), note);
});
