import fs from 'fs';
import path from 'path';
import { financialYearOf } from './financialYear.js';

const UNSAFE_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

function sanitizeSegment(raw, fallback) {
  const cleaned = String(raw || '')
    .replace(UNSAFE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, ''); // Windows disallows trailing dots on dir names
  return cleaned || fallback;
}

// Receipts used to be filed under a slug of the user's email. An id never
// changes, where an email does — and changing one silently orphaned every
// receipt, since the folder is derived rather than stored. Kept only so the
// startup migration can find the old folders (see migrations/receiptFolders).
//
// mike.smith@hotmail.com -> mike.smith-hotmail-com
export function legacyEmailToFolderSegment(email) {
  const str = String(email || '');
  const at = str.lastIndexOf('@');
  if (at === -1) return sanitizeSegment(str, 'user');
  const local = str.slice(0, at);
  const domain = str.slice(at + 1).replace(/\./g, '-');
  return sanitizeSegment(`${local}-${domain}`, 'user');
}

export function legacyUserRootDir(uploadsRoot, email) {
  return path.join(uploadsRoot, legacyEmailToFolderSegment(email));
}

// Category display names stay Title Case (see toTitleCase in categories
// routes), but the on-disk folder is always lowercase.
export function categoryToFolderSegment(name) {
  return sanitizeSegment(name, 'Uncategorised').toLowerCase();
}

export { financialYearOf };

// <uploads>/<userId> — the id is already filesystem-safe, but it's coerced
// through the same sanitiser so a bad caller can't walk out of uploads/.
export function userRootDir(uploadsRoot, userId) {
  return path.join(uploadsRoot, sanitizeSegment(userId, 'user'));
}

// Everything receipt-shaped for a user lives under here: the financial-year
// folders and the inbox. The extra segment leaves room for other per-user
// files (exports, avatars) to sit beside it later without mixing in with
// folders named after a financial year.
export const RECEIPTS_SEGMENT = 'receipts';

export function receiptsRootDir(uploadsRoot, userId) {
  return path.join(userRootDir(uploadsRoot, userId), RECEIPTS_SEGMENT);
}

// <uploads>/<userId>/receipts/<financial-year>/<category>
export function receiptDirFor(uploadsRoot, userId, purchaseDate, categoryName) {
  return path.join(
    receiptsRootDir(uploadsRoot, userId),
    financialYearOf(purchaseDate),
    categoryToFolderSegment(categoryName)
  );
}

// The same folders as receiptDirFor, but relative to the uploads root and
// always forward-slashed — this is what gets shown to the user, so it must
// read the same on Windows and Linux.
export function receiptRelDirFor(userId, purchaseDate, categoryName) {
  return [
    sanitizeSegment(userId, 'user'),
    RECEIPTS_SEGMENT,
    financialYearOf(purchaseDate),
    categoryToFolderSegment(categoryName),
  ].join('/');
}

// Receipts were once staged in a "_inbox" folder beside the financial years
// before being assigned to an expense. That feature is gone, but installs that
// used it still have the folder on disk — it's skipped when scanning year
// folders so it never gets mistaken for one.
export const INBOX_SEGMENT = '_inbox';

// Paperwork belonging to a category rather than to any single expense — a
// rental's agent statements and end-of-year summaries. Kept out of the
// receipts tree entirely so it's never picked up by anything scanning for
// financial-year folders.
export const DOCUMENTS_SEGMENT = 'documents';

// <uploads>/<userId>/documents/<category>/<financial-year>
//
// Rental paperwork is filed by year the same way receipts are — an agent
// statement or a depreciation schedule only means anything against the year it
// covers, and at tax time you want one year's documents together.
export function categoryDocumentDir(uploadsRoot, userId, categoryName, financialYear) {
  const base = path.join(userRootDir(uploadsRoot, userId), DOCUMENTS_SEGMENT, categoryToFolderSegment(categoryName));
  return financialYear ? path.join(base, financialYear) : base;
}

export function categoryDocumentRelDir(userId, categoryName, financialYear) {
  const parts = [sanitizeSegment(userId, 'user'), DOCUMENTS_SEGMENT, categoryToFolderSegment(categoryName)];
  if (financialYear) parts.push(financialYear);
  return parts.join('/');
}

// "2024-2025". Anything else is refused rather than sanitised — these come
// from the client and become a directory name.
const FINANCIAL_YEAR = /^\d{4}-\d{4}$/;

export function isFinancialYearLabel(label) {
  if (typeof label !== 'string' || !FINANCIAL_YEAR.test(label)) return false;
  const [start, end] = label.split('-').map(Number);
  return end === start + 1;
}

// Defense-in-depth: confirms `target` resolves to inside `root` before any
// fs operation touches it, on top of the filename/segment sanitization above.
export function assertWithin(root, target) {
  const resolvedRoot = path.resolve(root) + path.sep;
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== path.resolve(root) && !(resolvedTarget + path.sep).startsWith(resolvedRoot)) {
    throw new Error('Path escapes expected root');
  }
  return resolvedTarget;
}

const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

export function isSafeFilename(name) {
  return typeof name === 'string' && SAFE_FILENAME.test(name) && !name.includes('..');
}

// Turns an arbitrary upload name into one isSafeFilename() accepts, keeping it
// as close to what the user called it as the character rules allow —
// "Bunnings Invoice (1).PDF" becomes "bunnings-invoice-1.pdf". Uniqueness is
// not this function's job; see uniqueFilenameIn.
export function safeFilenameFrom(originalName) {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path
    .basename(originalName, path.extname(originalName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'receipt'}${ext}`;
}

// Keeps the name the upload came in with and only disambiguates when it has
// to: "invoice.pdf", then "invoice-2.pdf", then "invoice-3.pdf". Nothing on
// disk is ever overwritten.
//
// `taken` covers the gap fs.existsSync can't: several files in one request
// land in the same folder before any of them has finished writing, so names
// already handed out during this request are reserved in memory too.
export function uniqueFilenameIn(dir, desiredName, taken) {
  const safe = safeFilenameFrom(desiredName);
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);

  const isFree = (name) => !(taken && taken.has(name)) && !fs.existsSync(path.join(dir, name));

  let candidate = safe;
  for (let n = 2; !isFree(candidate); n++) {
    candidate = `${base}-${n}${ext}`;
    // Absurd only if something is very wrong; better than looping forever.
    if (n > 9999) {
      candidate = `${base}-${Date.now()}${ext}`;
      break;
    }
  }
  taken?.add(candidate);
  return candidate;
}

