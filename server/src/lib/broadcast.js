import { sentenceCase } from './text.js';

// Emailing everybody, or a named part of everybody.
//
// The pure half — who counts as an audience, what a message has to satisfy
// before it can be sent, and how a send is cut into batches. Kept away from the
// database and the mailer so all of it can be tested, because this is the one
// feature in the app where a mistake is delivered to every customer at once and
// cannot be taken back.

// Only accounts that have opened their activation link.
//
// An address that has never been confirmed is an address somebody typed, and it
// may belong to a person who has never heard of us. Sending marketing to it is
// how a domain ends up on a blocklist, and it takes one complaint.
const ACTIVATED = "activated_at IS NOT NULL AND role = 'owner'";

export const AUDIENCES = [
  {
    key: 'all',
    label: 'Everyone with a confirmed email',
    // Deliberately not "everyone". An account that never activated is not a
    // customer, it is an abandoned form.
    hint: 'Every account that has opened its activation link.',
    where: ACTIVATED,
  },
  {
    key: 'paying',
    label: 'Customers on a paid plan',
    hint: 'Accounts with a live subscription.',
    where: `${ACTIVATED} AND subscription_status IN ('active', 'past_due')`,
  },
  {
    key: 'trialing',
    label: 'Customers on a trial',
    hint: 'Still inside their free trial, nothing paid yet.',
    where: `${ACTIVATED} AND subscription_status = 'trialing'`,
  },
  {
    key: 'lapsed',
    label: 'Nobody on a plan',
    hint: 'Trial finished or subscription ended — not paying and not trialling.',
    where: `${ACTIVATED} AND subscription_status NOT IN ('active', 'past_due', 'trialing')`,
  },
];

export function audienceByKey(key) {
  return AUDIENCES.find((a) => a.key === key) || null;
}

export const MAX_SUBJECT = 140;
export const MIN_SUBJECT = 4;
export const MAX_BODY = 5000;
export const MIN_BODY = 20;

// How many go out at once.
//
// Twenty, and then a pause. A few hundred messages handed to the mail server in
// one breath is how a send gets throttled, deferred, or read as a burst by
// whatever is watching the outbound queue — and a deferred send is worse than a
// slow one, because nobody can tell whether it arrived.
export const BATCH_SIZE = 20;
export const BATCH_PAUSE_MS = 1000;

export function batchesOf(list, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Returns an error to refuse with, or null.
//
// Checked before anything is sent rather than per recipient: a message that
// cannot be sent to the first person cannot be sent to the four hundredth
// either, and finding that out half way through leaves a send nobody can
// repeat safely.
export function broadcastProblem({ audience, subject, body } = {}) {
  if (!audienceByKey(audience)) return 'Choose who this is going to';

  const cleanSubject = String(subject ?? '').trim();
  if (cleanSubject.length < MIN_SUBJECT) return `The subject needs at least ${MIN_SUBJECT} characters`;
  if (cleanSubject.length > MAX_SUBJECT) return `The subject can be at most ${MAX_SUBJECT} characters`;

  const cleanBody = String(body ?? '').trim();
  if (cleanBody.length < MIN_BODY) return `Write a little more — at least ${MIN_BODY} characters`;
  if (cleanBody.length > MAX_BODY) return `The message can be at most ${MAX_BODY} characters`;

  return null;
}

// What actually goes out, tidied.
//
// Sentence capitals on both, applied on the way out rather than as it is typed:
// this is written once and read by everybody, so it is worth arriving in
// sentences even when it was drafted in a hurry.
export function tidyBroadcast({ subject, body }) {
  return {
    subject: sentenceCase(String(subject ?? '').trim()).slice(0, MAX_SUBJECT),
    // Paragraph by paragraph, because sentenceCase collapses runs of
    // whitespace — run over the whole body it would join every paragraph into
    // one block and lose the shape somebody wrote.
    body: String(body ?? '')
      .trim()
      .split(/\n{2,}/)
      .map((paragraph) => sentenceCase(paragraph))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, MAX_BODY),
  };
}
