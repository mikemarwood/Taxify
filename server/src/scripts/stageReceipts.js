#!/usr/bin/env node
// One-off CLI to bulk-load a folder of receipts into a user's inbox, for when
// there are too many to drag through the browser. Files are copied (never
// moved) so the source folder is left untouched, and every name is rewritten
// to one the app's safe-filename guard accepts — "Invoice (1).pdf" becomes
// "invoice-1-a1b2c3.pdf". Subfolders are walked; the structure is flattened,
// since the inbox is a flat staging area and assigning a receipt is what
// files it under the right year and category.
//
// Usage:
//   node server/src/scripts/stageReceipts.js <source-dir> <email> [--dry-run]

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { inboxDirFor, stagedFilename, isSafeFilename, assertWithin } from '../lib/receiptStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.pdf']);
const MAX_BYTES = 5 * 1024 * 1024;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const [source, email] = argv.filter((a) => a !== '--dry-run');

  if (!source || !email) {
    console.error('Usage: node stageReceipts.js <source-dir> <email> [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error(`No such directory: ${source}`);
    process.exit(1);
  }

  const inbox = inboxDirFor(uploadsDir, email);
  if (!dryRun) fs.mkdirSync(inbox, { recursive: true });

  const files = walk(source);
  let staged = 0;
  const skipped = [];

  for (const full of files) {
    const original = path.basename(full);
    const ext = path.extname(original).toLowerCase();

    if (!ALLOWED_EXT.has(ext)) {
      skipped.push(`${original} — unsupported type (${ext || 'no extension'})`);
      continue;
    }
    const { size } = fs.statSync(full);
    if (size > MAX_BYTES) {
      skipped.push(`${original} — ${(size / 1024 / 1024).toFixed(1)}MB exceeds the 5MB limit`);
      continue;
    }

    let name = stagedFilename(original, crypto.randomBytes(3).toString('hex'));
    // Astronomically unlikely, but a collision would silently overwrite.
    while (fs.existsSync(path.join(inbox, name))) {
      name = stagedFilename(original, crypto.randomBytes(3).toString('hex'));
    }
    if (!isSafeFilename(name)) {
      skipped.push(`${original} — could not derive a safe filename`);
      continue;
    }

    const target = assertWithin(uploadsDir, path.join(inbox, name));
    if (dryRun) {
      console.log(`  would stage  ${original}  ->  ${name}`);
    } else {
      fs.copyFileSync(full, target);
      console.log(`  staged  ${original}  ->  ${name}`);
    }
    staged++;
  }

  console.log(`\n${dryRun ? 'Dry run — nothing copied. ' : ''}${staged} of ${files.length} file(s) ${dryRun ? 'would be' : ''} staged into:`);
  console.log(`  ${inbox}`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  if (!dryRun && staged > 0) {
    console.log(`\nOpen Expenses -> Receipt inbox in the app to assign them.`);
  }
}

main();
