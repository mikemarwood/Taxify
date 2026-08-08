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

export function looksLikeReference(value) {
  return /^TXF-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/.test(String(value || '').trim().toUpperCase());
}

// The link a guest reads their ticket through. Same shape as every other token
// here: the plain value goes in the email and only the hash is stored, so the
// database cannot be used to read somebody's conversation.
export function generateAccessToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashAccessToken(token) };
}

export function hashAccessToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export const STATUSES = ['awaiting_support', 'awaiting_customer', 'closed'];

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

export function statusLabel(status) {
  if (status === 'closed') return 'Closed';
  if (status === 'awaiting_customer') return 'Waiting for you';
  return 'With support';
}

// The same three states from support's side, where "waiting for you" means the
// opposite person.
export function adminStatusLabel(status) {
  if (status === 'closed') return 'Closed';
  if (status === 'awaiting_customer') return 'Waiting on customer';
  return 'Needs a reply';
}

const MAX_BODY = 5000;
const MAX_SUBJECT = 160;

export function messageProblem(body) {
  const text = String(body ?? '').trim();
  if (!text) return 'Write a message first';
  if (text.length > MAX_BODY) return `Messages can be at most ${MAX_BODY} characters`;
  return '';
}

export function subjectProblem(subject) {
  const text = String(subject ?? '').trim().replace(/\s+/g, ' ');
  if (text.length < 4) return 'Give it a short subject';
  if (text.length > MAX_SUBJECT) return `The subject can be at most ${MAX_SUBJECT} characters`;
  return '';
}

export { MAX_BODY, MAX_SUBJECT };
