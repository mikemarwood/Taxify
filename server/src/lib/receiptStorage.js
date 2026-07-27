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

export function categoryToFolderSegment(name) {
  return sanitizeSegment(name, 'Uncategorised');
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
