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

// mike.smith@hotmail.com -> mike.smith-hotmail-com
export function emailToFolderSegment(email) {
  const str = String(email || '');
  const at = str.lastIndexOf('@');
  if (at === -1) return sanitizeSegment(str, 'user');
  const local = str.slice(0, at);
  const domain = str.slice(at + 1).replace(/\./g, '-');
  return sanitizeSegment(`${local}-${domain}`, 'user');
}

// Category display names stay Title Case (see toTitleCase in categories
// routes), but the on-disk folder is always lowercase.
export function categoryToFolderSegment(name) {
  return sanitizeSegment(name, 'Uncategorised').toLowerCase();
}

export { financialYearOf };

export function receiptDirFor(uploadsRoot, email, purchaseDate, categoryName) {
  const emailSeg = emailToFolderSegment(email);
  const yearSeg = financialYearOf(purchaseDate);
  const categorySeg = categoryToFolderSegment(categoryName);
  return path.join(uploadsRoot, emailSeg, yearSeg, categorySeg);
}

export function userRootDir(uploadsRoot, email) {
  return path.join(uploadsRoot, emailToFolderSegment(email));
}

// Staging area for receipts uploaded in bulk before they're linked to an
// expense. Sits beside the financial-year folders under the user's root; the
// leading underscore keeps it from ever colliding with a "2024-2025" segment.
export const INBOX_SEGMENT = '_inbox';

export function inboxDirFor(uploadsRoot, email, folder) {
  const base = path.join(userRootDir(uploadsRoot, email), INBOX_SEGMENT);
  return folder ? path.join(base, folder) : base;
}

// The inbox may hold one level of subfolders, so an upload can keep the shape
// it already had on disk ("Home Rental", "Tooling") and be browsed that way
// when assigning. Same character rules as a filename — anything else is
// rejected rather than sanitised, since these arrive from the client.
const SAFE_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;

export function isSafeFolderName(name) {
  return typeof name === 'string' && SAFE_FOLDER.test(name) && !name.includes('..');
}

// "Home Rental" -> "home-rental". Mirrors categoryToFolderSegment so a staged
// folder lines up with the category it belongs to.
export function toFolderSlug(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
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
// recognisable in the picker. The random suffix means two files both called
// "invoice.pdf" can sit in the inbox together. `rand` is injected so callers
// decide the entropy source.
export function stagedFilename(originalName, rand) {
  const ext = path.extname(originalName).toLowerCase();
  const base = path
    .basename(originalName, path.extname(originalName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'receipt'}-${rand}${ext}`;
}
