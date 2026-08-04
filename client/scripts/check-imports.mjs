import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Catches calling a helper that was never imported.
//
// This shipped twice. Both times a sweep replaced call sites across the app —
// hard-coded dates with formatDate, a dollar sign with formatMoney — and a few
// files ended up calling a function they had no import for. JavaScript has
// nothing to say about that until the line actually runs, so the build passed,
// the page looked fine, and it only broke when someone opened that one modal.
// Two pages went to production that way: the admin user view and the expense
// editor, both with "Something went wrong on this page".
//
// The list of names is read from client/src/lib rather than written down here,
// so a new helper is covered the moment it is exported and there is no second
// list to keep in step.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');
const libDir = path.join(srcDir, 'lib');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(entry)) out.push(p);
  }
  return out;
}

// Every named export the shared helpers offer. Components are default exports
// and a missing one is a build error already, so only these need checking.
const exported = new Set();
for (const file of walk(libDir)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) exported.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let)\s+([A-Za-z0-9_$]+)/g)) exported.add(m[1]);
}

const problems = [];
for (const file of walk(srcDir)) {
  const src = fs.readFileSync(file, 'utf8');
  const known = new Set();

  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const parts = raw.trim().split(/\s+as\s+/);
      known.add((parts[1] || parts[0]).trim());
    }
  }
  // A file is free to declare its own function of the same name.
  for (const m of src.matchAll(/(?:function|const|let|var)\s+([A-Za-z0-9_$]+)/g)) known.add(m[1]);

  for (const name of exported) {
    // In call position only, and not preceded by a dot — obj.formatDate() is
    // somebody else's method, not this one.
    const called = new RegExp(`(?<![A-Za-z0-9_$.])${name}\\s*\\(`).test(src);
    if (called && !known.has(name)) {
      problems.push(`${path.relative(path.join(here, '..'), file).split(path.sep).join('/')} calls ${name}() but never imports it`);
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} helper${problems.length === 1 ? '' : 's'} used without an import:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nEach of these throws at render and shows the error boundary.\n');
  process.exit(1);
}

console.log(`imports ok — ${exported.size} shared helpers checked`);
