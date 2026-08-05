import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Every route module has to give index.js a default export.
//
// This exists because one did not, and the site was down for ten hours. A
// script that removed three retired routes cut from each route to the start of
// the next one — and the last route had no next one, so it took `export default
// router;` with it.
//
// Nothing caught it. `node --check` passes: a file with no default export is
// perfectly valid JavaScript. Importing the module passes too, because a
// dynamic import only fails on a missing binding if something asks for it. Only
// index.js's `import expensesRoutes from './routes/expenses.routes.js'` fails,
// and that happens at process start, so the first sign of it was a crash loop
// in production.
//
// The test is the shape of the mistake: import each route module the way
// index.js does, and check what index.js needs is actually there.

const here = path.dirname(fileURLToPath(import.meta.url));

// Route modules read config at import time; they only need it to be present.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-for-anything';

const routeFiles = fs
  .readdirSync(here)
  .filter((f) => f.endsWith('.routes.js'))
  .sort();

test('there are route modules to check', () => {
  assert.ok(routeFiles.length >= 5, `only found ${routeFiles.length} route modules`);
});

for (const file of routeFiles) {
  test(`${file} exports a router as default`, async () => {
    const mod = await import(`./${file}`);
    assert.ok(mod.default, `${file} has no default export — index.js cannot mount it`);
    // An Express router is a function with the routing methods hung off it.
    assert.equal(typeof mod.default, 'function', `${file}'s default export is not a router`);
    assert.equal(typeof mod.default.use, 'function', `${file}'s default export is not an Express router`);
  });
}

test('index.js imports a default from every route module it mounts', () => {
  // The other half: a module can export a default that index.js never asks for.
  // This catches the reverse mistake — a route file added but never mounted.
  const indexSource = fs.readFileSync(path.join(here, '..', 'index.js'), 'utf8');
  for (const file of routeFiles) {
    assert.ok(
      indexSource.includes(`./routes/${file}`),
      `${file} exists but index.js never imports it, so none of its routes are reachable`
    );
  }
});
