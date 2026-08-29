import fs from 'fs';
import path from 'path';
import { userRootDir } from './receiptStorage.js';
import { ticketDir } from './supportAttachments.js';

// Everything on disk that belongs to one account.
//
// It is three places, not one, and that is the bug this exists to close.
// Receipts and documents live under uploads/<id>/, which is the only one the
// admin panel counted and the only one deletion removed. An avatar lives in
// uploads/avatars/ — a flat folder shared by everybody, because an avatar is
// not a receipt and does not want a financial year over it. Support
// attachments live under uploads/support/<ticketId>/, keyed by conversation
// rather than by person, so that deleting one ticket is one directory.
//
// The consequence was an account reported as "0 MB of files will be deleted"
// while holding an avatar and a folder of attachments, and both surviving the
// account they belonged to. A figure that says zero when the answer is not
// zero is worse than no figure: it is used to decide.

const AVATARS_SEGMENT = 'avatars';

export function avatarFile(uploadsRoot, avatarPath) {
  if (!avatarPath) return null;
  // Only ever a bare filename from our own writer, but it is read out of the
  // database and joined into a path, so anything with a separator or a parent
  // reference in it is refused rather than followed.
  const name = String(avatarPath);
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  return path.join(uploadsRoot, AVATARS_SEGMENT, name);
}

// Bytes under a directory. Missing is 0, not an error — an account that never
// uploaded anything has no folder, and that is the ordinary case rather than a
// fault.
export function directorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(full);
      continue;
    }
    try {
      total += fs.statSync(full).size;
    } catch {
      // Vanished mid-walk. Counting it as nothing is right: it is gone.
    }
  }
  return total;
}

function fileSize(file) {
  if (!file) return 0;
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// Every path this account owns. Returned as a list rather than acted on, so
// the same answer drives both the figure shown and the deletion performed —
// a count and a delete that walk separately are a count and a delete that
// eventually disagree.
export function userFilePaths(uploadsRoot, { userId, avatarPath = null, ticketIds = [] } = {}) {
  const paths = [{ kind: 'dir', path: userRootDir(uploadsRoot, userId) }];

  const avatar = avatarFile(uploadsRoot, avatarPath);
  if (avatar) paths.push({ kind: 'file', path: avatar });

  for (const id of ticketIds) paths.push({ kind: 'dir', path: ticketDir(uploadsRoot, id) });

  return paths;
}

export function userStorageBytes(uploadsRoot, options) {
  return userFilePaths(uploadsRoot, options).reduce(
    (total, entry) => total + (entry.kind === 'dir' ? directorySize(entry.path) : fileSize(entry.path)),
    0
  );
}
