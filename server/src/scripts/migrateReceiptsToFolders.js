#!/usr/bin/env node
// One-off CLI to migrate receipt files from the old flat layout
// (uploads/<userId>/<file>) into the new per-user/year/category layout
// (uploads/<email-as-folder>/<financial-year>/<category>/<file>). Run
// locally against the live uploads dir — never invoked by the running
// server.
//
// Usage:
//   node server/src/scripts/migrateReceiptsToFolders.js --dry-run
//   node server/src/scripts/migrateReceiptsToFolders.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { ensureSchema } from '../db.js';
import { receiptDirFor } from '../lib/receiptStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const dryRun = process.argv.includes('--dry-run');

function moveFile(oldPath, newPath) {
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(oldPath, newPath);
      fs.unlinkSync(oldPath);
    } else {
      throw err;
    }
  }
}

async function main() {
  await ensureSchema();

  const [rows] = await pool.query(
    `SELECT e.id, e.user_id, e.receipt_path, e.purchase_date, u.email AS user_email, c.name AS category_name
     FROM expenses e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.receipt_path IS NOT NULL`
  );

  let moved = 0;
  let alreadyDone = 0;
  let missing = 0;
  let errors = 0;
  const touchedUserIds = new Set();

  for (const row of rows) {
    const oldPath = path.join(uploadsDir, String(row.user_id), row.receipt_path);
    const newDir = receiptDirFor(uploadsDir, row.user_email, row.purchase_date, row.category_name || 'Uncategorised');
    const newPath = path.join(newDir, row.receipt_path);

    if (fs.existsSync(newPath)) {
      alreadyDone++;
      continue;
    }
    if (!fs.existsSync(oldPath)) {
      missing++;
      console.warn(`[missing] expense ${row.id}: ${oldPath}`);
      continue;
    }

    touchedUserIds.add(row.user_id);
    if (dryRun) {
      console.log(`[dry-run] expense ${row.id}: ${oldPath} -> ${newPath}`);
      moved++;
      continue;
    }

    try {
      moveFile(oldPath, newPath);
      moved++;
    } catch (err) {
      errors++;
      console.error(`[error] expense ${row.id}: ${err.message}`);
    }
  }

  if (!dryRun) {
    for (const userId of touchedUserIds) {
      const oldUserDir = path.join(uploadsDir, String(userId));
      try {
        if (fs.existsSync(oldUserDir) && fs.readdirSync(oldUserDir).length === 0) {
          fs.rmdirSync(oldUserDir);
        }
      } catch (err) {
        console.error(`[error] cleaning up ${oldUserDir}: ${err.message}`);
      }
    }
  }

  console.log(
    `\n${dryRun ? 'DRY RUN — ' : ''}Done. moved=${moved} alreadyMigrated=${alreadyDone} missing=${missing} errors=${errors}`
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
