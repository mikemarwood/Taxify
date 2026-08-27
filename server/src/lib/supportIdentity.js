import crypto from 'crypto';

// Who a support ticket belongs to, kept out of the queue until somebody asks.
//
// The reason this is done on the server and not with CSS: anything the server
// sends, a support operator can read. Hiding a name in the markup while still
// putting it in the JSON is theatre — it stops nobody who opens devtools, and
// it is worse than doing nothing because it looks like a protection.
//
// What this is actually for is the ordinary case, not the determined one.
// Somebody working a queue of forty tickets does not need forty customers'
// names and faces on screen to answer a question about an export failing, and
// every one of those names is on a screen that gets shoulder-surfed, screen-
// shared and screenshotted into bug reports. The name is one click away when
// the job needs it, and that click is recorded.
//
// It is not a wall. An administrator can open the user list and read every
// name in it, and support staff can look somebody up by email to raise a
// ticket for them. Anybody claiming this makes identity unavailable would be
// wrong. It makes casual exposure stop being the default.

// Ambiguous characters left out, because these get read down a phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// A stable, meaningless name for one person.
//
// Seeded from the account id where there is one, so the same customer reads as
// the same pseudonym across every ticket they ever raise — which is the thing
// support actually needs from a name ("this is the person who wrote last
// week") without being told who they are. A guest has no account, so their
// ticket id is the seed and the pseudonym lasts as long as the ticket.
export function pseudonymFor(seed) {
  if (seed === null || seed === undefined || seed === '') return 'Customer';
  const digest = crypto.createHash('sha256').update(`taxify-support:${seed}`).digest();
  let out = '';
  for (let i = 0; i < 4; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return `Customer ${out}`;
}

// A colour for the placeholder avatar, from the same seed, so the row has
// something to recognise at a glance that is not a face.
export function pseudonymHue(seed) {
  if (seed === null || seed === undefined || seed === '') return 210;
  const digest = crypto.createHash('sha256').update(`taxify-support-hue:${seed}`).digest();
  return digest[0] % 360;
}

// Which seed a ticket uses. Exported so the reveal endpoint and the list
// cannot disagree about who a pseudonym refers to.
export function seedForTicket(row) {
  return row?.user_id ? `u${row.user_id}` : `t${row?.id}`;
}

// Strips the identifying fields out of a shaped ticket and puts the pseudonym
// in their place.
//
// Deliberately deletes rather than blanks: an empty string still tells you
// there was a field, and a later change that forgets to mask would show up as
// a name appearing rather than as a blank quietly filling in.
export function maskTicket(ticket, seed) {
  const masked = { ...ticket };
  delete masked.email;
  delete masked.avatarUrl;
  masked.who = pseudonymFor(seed);
  masked.hue = pseudonymHue(seed);
  masked.identityHidden = true;
  return masked;
}

// The same for one message in a thread.
//
// Only the customer's own messages: a reply from support is signed by the
// person who wrote it, and hiding staff from each other would stop a handover
// working while protecting nobody who needs protecting.
export function maskMessage(message, seed) {
  if (message.role !== 'customer') return message;
  const masked = { ...message };
  delete masked.avatarUrl;
  masked.name = pseudonymFor(seed);
  masked.hue = pseudonymHue(seed);
  masked.identityHidden = true;
  return masked;
}
