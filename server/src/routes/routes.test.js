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

// The routes each module must actually register.
//
// The test above proves a module still exports a router. It does not prove the
// router still has anything in it — and that is the mistake that happened next.
// A commit meant to remove two retired /family routes cut 444 lines, taking the
// body of POST /register and the whole activation flow with it. The file still
// parsed, still exported a router, still imported cleanly, and every test here
// passed. Nobody could create an account.
//
// So: name the routes that have to exist. Not all of them — the ones whose
// absence means a customer cannot get in, or cannot get back in.
const REQUIRED = {
  'auth.routes.js': [
    // Signing up, end to end. Each of these was missing at one point.
    ['post', '/register'],
    ['get', '/activate/check'],
    ['post', '/activate'],
    ['post', '/resend-activation'],
    // Getting back in.
    ['post', '/login'],
    ['post', '/forgot-password'],
    ['post', '/reset-password'],
    ['post', '/otp/verify'],
    // Sharing access.
    ['post', '/invite'],
    ['post', '/accept-invite'],
  ],
  'expenses.routes.js': [['get', '/'], ['post', '/']],
  'entities.routes.js': [['get', '/'], ['post', '/']],
  'deductions.routes.js': [['post', '/vehicle-trips'], ['post', '/home-office']],
  'billing.routes.js': [
    ['post', '/checkout'],
    ['post', '/change-plan'],
    ['get', '/change-preview'],
    ['get', '/invoices'],
    ['get', '/invoices/:id/pdf'],
    // Stripe calls this one. Losing it silently means subscriptions stop
    // being recorded and nobody finds out until somebody is locked out.
    ['post', '/webhook'],
  ],
};

// What Express actually mounted, read off the router rather than out of the
// source — a route that is commented out or unreachable does not count.
function mountedRoutes(router) {
  const found = new Set();
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods || {})) {
      found.add(`${method} ${layer.route.path}`);
    }
  }
  return found;
}

for (const [file, required] of Object.entries(REQUIRED)) {
  test(`${file} still registers the routes the app cannot work without`, async () => {
    const mod = await import(`./${file}`);
    const mounted = mountedRoutes(mod.default);
    for (const [method, routePath] of required) {
      assert.ok(
        mounted.has(`${method} ${routePath}`),
        `${file} no longer has ${method.toUpperCase()} ${routePath} — it registers: ${[...mounted].sort().join(', ') || '(nothing)'}`
      );
    }
  });
}
