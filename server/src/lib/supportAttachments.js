import fs from 'fs';
import path from 'path';

// Where a support attachment lives, and what is allowed to be one.
//
// Kept apart from receipts entirely: a receipt belongs to an account and is
// theirs to keep, while a support attachment belongs to a conversation and dies
// with it. Mixing them would mean deleting a ticket had to reason about which
// files were safe to remove.

export const SUPPORT_SEGMENT = 'support';

// Images only. Somebody attaching a screenshot is the whole use for this, and
// every other file type is a category of risk — an executable, an office
// document with macros, a PDF with a payload — for a feature nobody asked for.
// SVG is deliberately excluded: it is a document that can carry script, not a
// picture.
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['image/gif', '.gif'],
]);

// Large enough for a full-resolution phone screenshot, small enough that a
// mailbox full of them is not a disk problem.
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export const ATTACHMENT_REJECTED_MESSAGE = 'Attachments have to be images — JPG, PNG, WEBP, HEIC or GIF.';

export function isAllowedAttachment(file) {
  return ALLOWED.has(String(file?.mimetype || '').toLowerCase());
}

export function extensionFor(file) {
  return ALLOWED.get(String(file?.mimetype || '').toLowerCase()) || '';
}

// One folder per ticket, named by its id. Everything a conversation holds is
// therefore removable by removing one directory — which is what makes deleting
// a ticket a single, complete operation rather than a list of files to chase.
export function ticketDir(uploadsRoot, ticketId) {
  const id = String(Number(ticketId) || 0);
  return path.join(uploadsRoot, SUPPORT_SEGMENT, id);
}

export function ensureTicketDir(uploadsRoot, ticketId) {
  const dir = ticketDir(uploadsRoot, ticketId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The stored name. Never the name the browser sent: that is attacker-controlled
// text, and it only has to contain a slash or a pair of dots once to reach
// somewhere it should not. The original is kept in the database for display.
export function storedFilename(messageId, index, file) {
  return `${Number(messageId) || 0}-${index}${extensionFor(file)}`;
}

// Removes everything a ticket holds. Safe to call for a ticket that never had
// an attachment, which is most of them.
export function removeTicketFiles(uploadsRoot, ticketId) {
  // A ticket id that is not a positive whole number is refused outright rather
  // than coerced. ticketDir() would turn it into folder "0" — harmless in
  // itself, but this is a recursive delete, and "we made the bad input into a
  // different path and deleted that instead" is not a guard.
  const id = Number(ticketId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const dir = ticketDir(uploadsRoot, id);
  // Refuses to act on anything that is not inside the support folder, so a bad
  // id can never point the recursive delete somewhere else.
  const root = path.resolve(path.join(uploadsRoot, SUPPORT_SEGMENT));
  const target = path.resolve(dir);
  if (target === root || !target.startsWith(root + path.sep)) return false;

  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

// Whether a path really sits inside this ticket's folder. Checked before a file
// is served, because the row it came from is not proof on its own — a stored
// path is only as trustworthy as whatever wrote it.
export function isInsideTicket(uploadsRoot, ticketId, filePath) {
  const dir = path.resolve(ticketDir(uploadsRoot, ticketId));
  const target = path.resolve(filePath);
  return target.startsWith(dir + path.sep);
}
