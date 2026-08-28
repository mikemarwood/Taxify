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
// So every reply reaches a customer as "Taxify Support" with the Taxify mark
// beside it, whoever wrote it. One identity rather than a per-person handle:
// the customer is dealing with the company, and a name that changes between
// replies invites the question of who they are speaking to now — which is
// exactly the question this exists to stop having to answer.
//
// Support staff see the same label with the real name underneath it, because
// a queue where nobody can tell who answered is a queue where a handover
// cannot happen and nobody can be asked about their own reply.
//
// Support staff still see customers by name. They are answering a question
// about a real account and often have to check they are talking to the person
// who owns it, and a pseudonym there costs more than it protects.

// The name a customer sees on anything from us. Always this, for everybody.
//
// It takes no argument on purpose. A function that accepted a name and
// sometimes returned part of it is a function somebody will later be tempted
// to make return a bit more of it.
export const SUPPORT_DISPLAY_NAME = 'Taxify Support';

export function supportDisplayName() {
  return SUPPORT_DISPLAY_NAME;
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
export function maskStaffMessage(message, { staff = false } = {}) {
  if (!message || message.role !== 'support') return message;
  const masked = { ...message };
  delete masked.avatarUrl;
  masked.name = SUPPORT_DISPLAY_NAME;
  // The client swaps in the Taxify mark on this, rather than deriving initials
  // from "Taxify Support" — which would read as a person's initials and is not.
  masked.fromSupport = true;
  // Who actually wrote it, for the support side only. Carried as a separate
  // field rather than by leaving `name` alone, so the label a customer sees
  // and the label staff see are the same string with one extra line under it —
  // and so a screen that forgets to handle it shows less, not more.
  if (staff && message.name) masked.staffName = message.name;

  // A customer does not get our revision history.
  //
  // "Edited — see what changed" is right on their own message: it is their
  // words and their record of changing them. On ours it publishes an
  // operator's drafting — a figure corrected before sending, a sentence
  // rewritten to be kinder — as though the first attempt were part of the
  // answer. What was sent is the answer.
  //
  // Removed rather than emptied, for the same reason as the avatar: a route
  // that later forgets to mask shows something that should not be there,
  // rather than a blank quietly filling in. Staff keep both, because that is
  // the record of who changed what.
  if (!staff) {
    delete masked.history;
    delete masked.editedAt;
  }
  return masked;
}
