import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The server half of client/scripts/check-imports.mjs, and it exists because
// the same bug reached production here too.
//
// auth.routes.js called notify() five times and never imported it. JavaScript
// says nothing about that until the line runs, so the tests passed, the server
// started, and every one of those paths threw ReferenceError the moment
// somebody pressed the button — surfacing only as "Something went wrong",
// because the 500 handler will not show an internal message. Revoking an
// accountant's access and accepting an invitation both failed that way, and
// both had already written to the database by the time the throw happened.
//
// The names come from server/src/lib and server/src/auth rather than a list
// written down here, so a new helper is covered the moment it is exported.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');
const sharedDirs = [path.join(srcDir, 'lib'), path.join(srcDir, 'auth')];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    // Tests declare fixtures with helper names on purpose.
    else if (/\.m?js$/.test(entry) && !/\.test\.m?js$/.test(entry)) out.push(p);
  }
  return out;
}

const exported = new Set();
for (const dir of sharedDirs) {
  for (const file of walk(dir)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) exported.add(m[1]);
    for (const m of src.matchAll(/export\s+(?:const|let)\s+([A-Za-z0-9_$]+)/g)) exported.add(m[1]);
  }
}

const problems = [];
for (const file of walk(srcDir)) {
  const raw = fs.readFileSync(file, 'utf8');

  // SQL lives in template literals throughout this codebase and a table called
  // `notifications` should not read as a call to notify(). Blank out template
  // literals, keeping newlines so any line number still lines up.
  const src = raw.replace(/`[^`]*`/g, (m) => m.replace(/[^\n]/g, ' '));

  const known = new Set();

  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const rawName of m[1].split(',')) {
      const parts = rawName.trim().split(/\s+as\s+/);
      known.add((parts[1] || parts[0]).trim());
    }
  }
  // A default or namespace import binds a name too.
  for (const m of src.matchAll(/import\s+([A-Za-z0-9_$]+)\s*(?:,|from)/g)) known.add(m[1]);
  for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z0-9_$]+)/g)) known.add(m[1]);

  // A file is free to declare its own function of the same name.
  for (const m of src.matchAll(/(?:function|const|let|var)\s+([A-Za-z0-9_$]+)/g)) known.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*[[{]([^\]}]*)[\]}]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.includes(':') ? part.split(':').pop() : part.split('=')[0];
      const clean = name.replace(/[^A-Za-z0-9_$]/g, '');
      if (clean) known.add(clean);
    }
  }

  for (const name of exported) {
    // Call position only, and never after a dot — pool.query() is not query().
    const called = new RegExp(`(?<![A-Za-z0-9_$.])${name}\\s*\\(`).test(src);
    if (called && !known.has(name)) {
      problems.push(`${path.relative(path.join(here, '..'), file).split(path.sep).join('/')} calls ${name}() but never imports it`);
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} helper${problems.length === 1 ? '' : 's'} used without an import:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nEach of these throws the moment that line runs, and the caller only sees "Something went wrong".\n');
  process.exit(1);
}

console.log(`imports ok — ${exported.size} shared helpers checked`);
