#!/usr/bin/env node
// Moves Taxify's version on by one patch, in all three package.json files.
//
// Why this exists: pm2 prints a version column, and every other app on the box
// has a real number in it. Taxify sat on the placeholder 1.0.0 through
// hundreds of deploys, so the one place you can see what is running told you
// nothing — two servers could be days apart and look identical.
//
// pm2 reads the version from the package.json beside the script it is running,
// which is server/package.json (see ecosystem.config.cjs, where cwd is
// ./server). The root and client copies are moved with it so the three cannot
// drift into three different answers to the same question.
//
// Run before committing an update:
//
//   node ops/bump-version.mjs
//
// Deliberately not run by deploy.sh. That runs on the server from a git pull,
// and writing to a tracked file there would leave the working tree dirty and
// fight the next pull. The number belongs to the commit, not to the machine
// that happens to be running it.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['package.json', 'server/package.json', 'client/package.json'];

const current = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8')).version;
const parts = String(current).split('.').map(Number);
if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
  console.error(`Cannot read a major.minor.patch version from server/package.json — found "${current}"`);
  process.exit(1);
}

parts[2] += 1;
const next = parts.join('.');

for (const file of files) {
  const full = path.join(root, file);
  const raw = fs.readFileSync(full, 'utf8');
  // Textual, one line, rather than a parse and re-serialise: rewriting the
  // whole file would reformat it and bury the one thing that changed.
  const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`);
  if (updated === raw) {
    console.error(`No version field found in ${file}`);
    process.exit(1);
  }
  fs.writeFileSync(full, updated);
}

console.log(`${current} → ${next}`);
