import test from 'node:test';
import assert from 'node:assert/strict';
import { publicOrigin, appOrigin, resetOriginWarning } from './publicOrigin.js';

// The module warns once per process, so the scenarios run in one test in a
// fixed order rather than as separate cases that would race that flag.
function withEnv({ nodeEnv, clientOrigin }, run) {
  const before = { NODE_ENV: process.env.NODE_ENV, CLIENT_ORIGIN: process.env.CLIENT_ORIGIN };
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (clientOrigin === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = clientOrigin;
  try {
    return run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('an unset CLIENT_ORIGIN falls back to the real address, not to localhost', () => {
  // This is how the production server actually runs. The constant in the
  // module is the one place the address lives.
  const origin = withEnv({ nodeEnv: 'production' }, publicOrigin);
  assert.equal(origin, 'https://taxify.net.au');
});

test('a configured origin is used as given', () => {
  assert.equal(
    withEnv({ nodeEnv: 'production', clientOrigin: 'https://example.test' }, publicOrigin),
    'https://example.test'
  );
});

test('a trailing slash is not carried into a link', () => {
  assert.equal(
    withEnv({ nodeEnv: 'production', clientOrigin: 'https://example.test/' }, publicOrigin),
    'https://example.test'
  );
});

test('a leftover localhost is refused in production', () => {
  // The bug this module exists for: a .env still carrying the development
  // value put http://localhost:5173 into real customers' email, and a
  // password reset nobody can open is indistinguishable from a broken account.
  for (const local of ['http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:8080']) {
    assert.equal(
      withEnv({ nodeEnv: 'production', clientOrigin: local }, publicOrigin),
      'https://taxify.net.au',
      local
    );
  }
});

test('development still uses localhost', () => {
  assert.equal(withEnv({ nodeEnv: undefined }, publicOrigin), 'http://localhost:5173');
  assert.equal(
    withEnv({ nodeEnv: 'development', clientOrigin: 'http://localhost:4000' }, publicOrigin),
    'http://localhost:4000'
  );
});

test('the app lives under /app, wherever the site is', () => {
  assert.equal(withEnv({ nodeEnv: 'production' }, appOrigin), 'https://taxify.net.au/app');
  assert.equal(
    withEnv({ nodeEnv: 'production', clientOrigin: 'https://example.test/' }, appOrigin),
    'https://example.test/app'
  );
});

test('only a wrong value is complained about, never a missing one', () => {
  // An error logged every restart for the expected case is an error nobody
  // reads by the time there is a real one.
  // Earlier cases in this file have already spent the once-per-process flag.
  resetOriginWarning();
  const said = [];
  const real = console.error;
  console.error = (...args) => said.push(args.join(' '));
  try {
    withEnv({ nodeEnv: 'production' }, publicOrigin);
    withEnv({ nodeEnv: 'production', clientOrigin: 'https://example.test' }, publicOrigin);
    assert.deepEqual(said, [], 'nothing to say about a correct configuration');

    withEnv({ nodeEnv: 'production', clientOrigin: 'http://localhost:5173' }, publicOrigin);
    assert.equal(said.length, 1);
    assert.match(said[0], /localhost:5173/);

    // Once per process, not once per link — this is called on every link built.
    withEnv({ nodeEnv: 'production', clientOrigin: 'http://localhost:5173' }, publicOrigin);
    assert.equal(said.length, 1);
  } finally {
    console.error = real;
  }
});
