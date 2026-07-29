import fs from 'fs';
import path from 'path';
import { getSetting, setSetting } from '../db.js';
import { legacyUserRootDir, receiptsRootDir, userRootDir } from '../lib/receiptStorage.js';

const DONE_KEY = 'receipt_folders_by_user_id_done';

// Receipts used to live at <uploads>/<email-slug>/<financial-year>/<category>.
// They now live at <uploads>/<userId>/receipts/<financial-year>/<category>: an
// id never changes where an email does, and the extra segment keeps receipts
// from being mistaken for other per-user files.
//
// Only the directory moves. receipt_path stores a bare filename and the folder
// is derived on every read, so there is nothing in the database to rewrite —
// which is also why this has to run before the app serves a single request.
// It's guarded by a settings flag so a restart doesn't redo the work.
export async function migrateReceiptFolders(pool, uploadsDir) {
  if ((await getSetting(DONE_KEY)) === 'true') return;

  const [users] = await pool.execute('SELECT id, email FROM users');
  let moved = 0;
  let merged = 0;

  for (const user of users) {
    const legacyDir = legacyUserRootDir(uploadsDir, user.email);
    if (!fs.existsSync(legacyDir)) continue;

    const destination = receiptsRootDir(uploadsDir, user.id);
    fs.mkdirSync(userRootDir(uploadsDir, user.id), { recursive: true });

    if (!fs.existsSync(destination)) {
      // The common case: nothing at the new path yet, so the whole tree moves
      // in one rename and the year/category/_inbox layout is carried over.
      fs.renameSync(legacyDir, destination);
      moved++;
      console.log(`[receipt-folders] ${legacyDir} -> ${destination}`);
      continue;
    }

    // A partly-migrated install (or a crash mid-run) can leave both paths
    // present. Merge rather than clobber: anything already at the destination
    // is newer, so a colliding file is left alone and its old copy kept where
    // it is for a human to look at.
    mergeInto(legacyDir, destination);
    merged++;
    console.log(`[receipt-folders] merged ${legacyDir} into ${destination}`);
  }

  await setSetting(DONE_KEY, 'true');
  if (moved || merged) {
    console.log(`[receipt-folders] done — ${moved} moved, ${merged} merged`);
  }
}

function mergeInto(sourceDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      mergeInto(from, to);
      continue;
    }
    if (fs.existsSync(to)) continue; // destination wins
    fs.renameSync(from, to);
  }
  // Only removes the directory once it's actually empty; anything left behind
  // is a collision worth keeping.
  try {
    fs.rmdirSync(sourceDir);
  } catch {
    // not empty — intentional
  }
}
