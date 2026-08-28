import test from 'node:test';
import assert from 'node:assert/strict';
import { firstNameOf, supportDisplayName, maskStaffMessage } from './supportIdentity.js';

test('a reply is signed with a first name somebody can address', () => {
  // Not Operator #3. The point is a customer knowing a person answered and
  // being able to thank them by name — only the surname and the photograph
  // are worth withholding.
  assert.equal(supportDisplayName('Mike Marwood'), 'Support_Mike');
  assert.equal(supportDisplayName('mike'), 'Support_Mike');
});

test('only the working name survives', () => {
  assert.equal(firstNameOf('Anne-Marie Dubois'), 'Anne-Marie');
  assert.equal(firstNameOf("O'Brien"), "O'Brien");
  assert.equal(firstNameOf('  jane   smith  '), 'Jane');
});

test('a name that is not a name does not produce a broken label', () => {
  // The column is free text and has held an empty string before now. A label
  // reading "Support_" or "Support_undefined" is worse than no name at all.
  for (const bad of ['', '   ', null, undefined, '???', '42']) {
    assert.equal(supportDisplayName(bad), 'Support', JSON.stringify(bad));
  }
});

test('nothing that could carry markup gets into the label', () => {
  // It is rendered as text, but this is a name from a database going onto a
  // page a stranger reads, so the characters are limited at the source too.
  // Asserting the property rather than the exact output: what matters is that
  // no angle bracket, quote or slash can reach the page, not which letters
  // survive the stripping.
  for (const nasty of ['<script>alert(1)</script>', '<b>Mike</b>', 'Mike" onload="x', "Mike'); drop--"]) {
    const label = supportDisplayName(nasty);
    // The apostrophe is deliberately not on this list: O'Brien is a name, and
    // the label is rendered as text where an apostrophe is only an apostrophe.
    assert.ok(!/[<>"/()&;]/.test(label.replace(/^Support_/, '')), label);
  }
});

test('the face goes, and it goes rather than being blanked', () => {
  const reply = { role: 'support', name: 'Mike Marwood', avatarUrl: '/api/auth/avatar/1', body: 'Try this.' };
  const masked = maskStaffMessage(reply);

  assert.equal(masked.name, 'Support_Mike');
  assert.equal(Object.prototype.hasOwnProperty.call(masked, 'avatarUrl'), false);
  assert.equal(masked.fromSupport, true);
  // What they wrote is not touched. This hides who, never what.
  assert.equal(masked.body, 'Try this.');
  // And the original survives, because the same row is used to send email.
  assert.equal(reply.name, 'Mike Marwood');
});

test('the customer is never masked on their own thread', () => {
  // They wrote it. Replacing their own name with a pseudonym in their own
  // conversation would be baffling, and it is the reason the earlier version
  // of this file was wrong.
  const mine = { role: 'customer', name: 'Jane Smith', avatarUrl: '/api/auth/avatar/42' };
  assert.deepEqual(maskStaffMessage(mine), mine);
});

test('an internal note is passed through untouched', () => {
  // Notes never reach a customer at all — messagesFor filters them out long
  // before this. Masking one would only hide a name from the staff who wrote
  // it for each other.
  const note = { role: 'note', name: 'Mike Marwood' };
  assert.deepEqual(maskStaffMessage(note), note);
});
