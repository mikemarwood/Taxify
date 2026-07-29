#!/usr/bin/env node
// One-off CLI to bulk-load a folder of receipts into a user's inbox, for when
// there are too many to drag through the browser. Files are copied (never
// moved) so the source folder is left untouched, and every name is rewritten
// to one the app's safe-filename guard accepts — "Invoice (1).pdf" becomes
// "invoice-1-a1b2c3.pdf".
//
// Subfolders are preserved one level deep, slugified to match the category
// folders the app uses ("Home Rental" -> "home-rental"), so the picker can be
// browsed a folder at a time. Anything nested deeper collapses into its
// top-level folder, and files sitting loose at the top stay at the inbox root.
//
// Usage:
//   node server/src/scripts/stageReceipts.js <source-dir> <email> [--dry-run] [--flat]

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { inboxDirFor, stagedFilename, isSafeFilename, isSafeFolderName, toFolderSlug, assertWithin } from '../lib/receiptStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.pdf']);
const MAX_BYTES = 10 * 1024 * 1024;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// Top-level folder of `full` relative to `source`, slugified — or null when
// the file sits directly in the source folder.
function folderFor(source, full, flat) {
  if (flat) return null;
  const rel = path.relative(source, full);
  const parts = rel.split(path.sep);
  if (parts.length < 2) return null;
  const slug = toFolderSlug(parts[0]);
  return isSafeFolderName(slug) ? slug : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const flat = argv.includes('--flat');
  const [source, email] = argv.filter((a) => !a.startsWith('--'));

  if (!source || !email) {
    console.error('Usage: node stageReceipts.js <source-dir> <email> [--dry-run] [--flat]');
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error(`No such directory: ${source}`);
    process.exit(1);
  }

  // Folders are keyed by user id, but an email is what a human running this
  // actually knows, so it's resolved here rather than asked for.
  const [users] = await pool.execute('SELECT id FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!users[0]) {
    console.error(`No user with the email ${email}`);
    process.exit(1);
  }
  const userId = users[0].id;

  const inboxRoot = inboxDirFor(uploadsDir, userId);
  if (!dryRun) fs.mkdirSync(inboxRoot, { recursive: true });

  const files = walk(source);
  let staged = 0;
  const skipped = [];
  const perFolder = {};

  for (const full of files) {
    const original = path.basename(full);
    const ext = path.extname(original).toLowerCase();
    const folder = folderFor(source, full, flat);
    const inbox = folder ? path.join(inboxRoot, folder) : inboxRoot;

    if (!ALLOWED_EXT.has(ext)) {
      skipped.push(`${original} — unsupported type (${ext || 'no extension'})`);
      continue;
    }
    const { size } = fs.statSync(full);
    if (size > MAX_BYTES) {
      skipped.push(`${original} — ${(size / 1024 / 1024).toFixed(1)}MB exceeds the 10MB limit`);
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
    const label = folder ? `${folder}/${name}` : name;
    if (dryRun) {
      console.log(`  would stage  ${original}  ->  ${label}`);
    } else {
      fs.mkdirSync(inbox, { recursive: true });
      fs.copyFileSync(full, target);
      console.log(`  staged  ${original}  ->  ${label}`);
    }
    perFolder[folder || '(root)'] = (perFolder[folder || '(root)'] || 0) + 1;
    staged++;
  }

  console.log(`\n${dryRun ? 'Dry run — nothing copied. ' : ''}${staged} of ${files.length} file(s) ${dryRun ? 'would be' : ''} staged into:`);
  console.log(`  ${inboxRoot}`);
  const groups = Object.entries(perFolder).sort();
  if (groups.length > 0) {
    console.log('\nBy folder:');
    for (const [name, n] of groups) console.log(`  ${name.padEnd(28)} ${n}`);
  }
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  if (!dryRun && staged > 0) {
    console.log(`\nOpen Expenses -> Receipt inbox in the app to assign them.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
