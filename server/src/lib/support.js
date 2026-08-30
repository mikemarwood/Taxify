import crypto from 'crypto';

// What somebody can be writing in about. Required, because the first thing
// support does with a message is decide which of these it is, and the person
// writing already knows.
export const SUPPORT_CATEGORIES = [
  { value: 'billing', label: 'Billing and plans', hint: 'Payments, invoices, changing or cancelling a plan' },
  { value: 'account', label: 'Account and sign-in', hint: 'Signing in, two-factor, changing your email' },
  { value: 'expenses', label: 'Expenses and receipts', hint: 'Adding, editing or attaching things' },
  { value: 'reports', label: 'Reports and tax time', hint: 'Reports, exports, finalising a year' },
  { value: 'accountant', label: 'Accountant access', hint: 'Sharing your books with an accountant' },
  { value: 'app', label: 'The Android app', hint: 'Installing, updating or notifications' },
  { value: 'other', label: 'Something else', hint: 'Anything that does not fit above' },
];

const CATEGORY_VALUES = new Set(SUPPORT_CATEGORIES.map((c) => c.value));

export function isCategory(value) {
  return CATEGORY_VALUES.has(String(value || ''));
}

export function categoryLabel(value) {
  return SUPPORT_CATEGORIES.find((c) => c.value === value)?.label || 'Support';
}

// The number people quote back.
//
// Not the row id. "Ticket 3" tells a customer they are the third person ever to
// write in, and tells anybody else exactly how many customers there are. The
// year is worth carrying because it dates the conversation at a glance, and the
// random block means two tickets raised a second apart look unrelated.
//
// Crockford's alphabet: no I, L, O or U, so nothing can be misread down a phone
// line or mistyped as a one or a zero.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateReference(now = new Date()) {
  const year = now.getFullYear();
  const bytes = crypto.randomBytes(6);
  let block = '';
  for (let i = 0; i < 6; i += 1) block += ALPHABET[bytes[i] % ALPHABET.length];
  return `TXF-${year}-${block}`;
}


// The link a guest reads their ticket through. Same shape as every other token
// here: the plain value goes in the email and only the hash is stored, so the
// database cannot be used to read somebody's conversation.
// 48 bytes — 384 bits of randomness, 64 characters of base64url.
//
// This link is the entire authority over somebody's conversation: there is no
// account behind it and no second factor, so it has to be unguessable rather
// than merely long. At this size the space cannot be searched, and there is
// nothing inside a token to reason from — no ticket id, no address, no time —
// so holding one link says nothing whatever about where any other one lives.
export const ACCESS_TOKEN_BYTES = 48;

export function generateAccessToken() {
  const token = crypto.randomBytes(ACCESS_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashAccessToken(token) };
}

export function hashAccessToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export const STATUSES = ['awaiting_support', 'awaiting_customer', 'closed'];

// Ordered worst first, which is the order the queue is sorted in.
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

export function isPriority(value) {
  return PRIORITIES.includes(String(value || ''));
}

// How long a ticket may sit with us before it is worth flagging. Not a promise
// to anybody — it is there so a ticket assigned to somebody on holiday shows up
// as neglected instead of sitting at "awaiting reply" indefinitely.
export const STALE_AFTER_HOURS = { urgent: 4, high: 12, normal: 48, low: 120 };

export function isStale(ticket, now = Date.now()) {
  if (!ticket || ticket.status !== 'awaiting_support') return false;
  const since = new Date(ticket.lastMessageAt || ticket.createdAt || 0).getTime();
  if (!since) return false;
  const limit = (STALE_AFTER_HOURS[ticket.priority] ?? STALE_AFTER_HOURS.normal) * 60 * 60 * 1000;
  return now - since > limit;
}

// Whose turn it becomes after somebody writes. Support replying puts it back to
// the customer; the customer replying puts it back to support. A closed ticket
// stays closed — reopening is a decision, not a side effect of typing.
export function statusAfterReply(current, authorRole) {
  if (current === 'closed') return 'closed';
  return authorRole === 'support' ? 'awaiting_customer' : 'awaiting_support';
}

export function canReply(ticket) {
  return ticket?.status !== 'closed';
}

// Matched to the form, so nothing is accepted there and refused here.
const MAX_BODY = 5000;

// A first message and a reply are held to different lengths, deliberately.
//
// Opening a ticket with "help" gives whoever picks it up nothing to work with
// and costs a round trip to ask what happened, so twenty characters is a fair
// ask of somebody describing a problem from scratch.
//
// A reply is the opposite case. "Yes", "Thanks", "Tuesday works" and "Fixed,
// thank you" are complete answers to a question already on the thread, and
// refusing them makes somebody pad a sentence to satisfy a rule — which wastes
// their time and tells the reader nothing. Six is enough to catch a stray
// keypress and nothing more.
const MIN_BODY = 20;
const MIN_REPLY = 6;
const MAX_SUBJECT = 120;
const MIN_SUBJECT = 6;

export function messageProblem(body) {
  const text = String(body ?? '').trim();
  if (!text) return 'Write a message first';
  if (text.length < MIN_BODY) return `Tell us a little more — at least ${MIN_BODY} characters`;
  if (text.length > MAX_BODY) return `Messages can be at most ${MAX_BODY} characters`;
  return '';
}

// A reply on a thread that already has the question on it.
export function replyProblem(body) {
  const text = String(body ?? '').trim();
  if (!text) return 'Write a reply first';
  if (text.length < MIN_REPLY) return `A little more than that — at least ${MIN_REPLY} characters`;
  if (text.length > MAX_BODY) return `Messages can be at most ${MAX_BODY} characters`;
  return '';
}

export function subjectProblem(subject) {
  const text = String(subject ?? '').trim().replace(/\s+/g, ' ');
  if (text.length < MIN_SUBJECT) return `The subject needs at least ${MIN_SUBJECT} characters`;
  if (text.length > MAX_SUBJECT) return `The subject can be at most ${MAX_SUBJECT} characters`;
  return '';
}

export { MAX_BODY, MIN_BODY, MIN_REPLY, MAX_SUBJECT, MIN_SUBJECT };
