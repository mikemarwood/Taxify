// Who answered a support ticket, as the customer sees it.
//
// This file used to do the opposite — hide the customer from support staff —
// which was a misreading of what was asked for. It is the person answering who
// wants covering, not the person writing in. A support operator's full name
// and photograph on every reply is their name and face handed to every
// stranger who ever emails in, and there is no reason for a customer to have
// either: they need to know a person answered, that it is the same person as
// last time, and how to address them.
//
// So a reply is signed Support_Mike with the Taxify mark beside it. The first
// name is kept deliberately — "Support_Mike" is somebody you can thank, and
// there is nothing to be gained by making it Operator #3.
//
// Support staff still see customers by name. They are answering a question
// about a real account and often have to check they are talking to the person
// who owns it, and a pseudonym there costs more than it protects.

// Everything before the first space, and only the letters. A double-barrelled
// surname or a middle name is not part of a working name, and anything that is
// not a letter is dropped so the label can never carry markup.
export function firstNameOf(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  const letters = first.replace(/[^\p{L}'-]/gu, '');
  if (!letters) return '';
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

// The name a customer sees on a reply from us.
export function supportDisplayName(fullName) {
  const first = firstNameOf(fullName);
  return first ? `Support_${first}` : 'Support';
}

// Hides the person behind one message, for the customer's side of a thread.
//
// Only replies from support and only the display of them: the body is
// untouched, and an internal note never reaches this because it is filtered
// out long before, in messagesFor.
//
// avatarUrl is deleted rather than blanked. An empty string still says there
// was a field, and a route added later that forgets to mask would look like a
// blank quietly filling in rather than like a face appearing where none should
// be.
export function maskStaffMessage(message) {
  if (!message || message.role !== 'support') return message;
  const masked = { ...message };
  delete masked.avatarUrl;
  masked.name = supportDisplayName(message.name);
  // The client swaps in the Taxify mark on this, rather than deriving initials
  // from "Support_Mike" — which would read as a person's initials and is not.
  masked.fromSupport = true;
  return masked;
}
