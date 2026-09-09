import test from 'node:test';
import assert from 'node:assert/strict';
import { injectLandingScript } from './landingScript.js';

const PAGE = '<!doctype html><html><body><main>Taxify</main></body></html>';

test('the script goes in, at the end of the body', () => {
  const out = injectLandingScript(PAGE);
  assert.ok(out.includes('scrollRestoration'));
  // Before the closing tag, not after it.
  assert.ok(out.indexOf('scrollRestoration') < out.indexOf('</body>'));
  // And after the content, so nothing on the page waits for it.
  assert.ok(out.indexOf('<main>') < out.indexOf('scrollRestoration'));
});

test('it goes in once, however many times the page is served', () => {
  const once = injectLandingScript(PAGE);
  const twice = injectLandingScript(once);
  assert.equal(twice, once);
  // Counted on the marker, not on a word inside the script — the script names
  // scrollRestoration twice by design, once to test for it and once to set it.
  assert.equal(twice.split('<!--LANDING-JS-->').length - 1, 1);
});

test('a page with no closing body tag still gets it', () => {
  // The hub assembles its own markup. A missing closing tag should mean a page
  // without this, not a page thrown away.
  const out = injectLandingScript('<div>no body tag here</div>');
  assert.ok(out.includes('scrollRestoration'));
  assert.ok(out.startsWith('<div>no body tag here</div>'));
});

test('nothing in, nothing out', () => {
  assert.equal(injectLandingScript(''), '');
  assert.equal(injectLandingScript(null), '');
  assert.equal(injectLandingScript(undefined), '');
});

test('a fragment is left alone', () => {
  // Somebody following a link to #plans means to arrive at the plans, and the
  // scroll reset must not undo that. The guard is in the script itself, so
  // this checks the condition is actually written.
  const out = injectLandingScript(PAGE);
  assert.ok(out.includes('if(!location.hash)'));
});

test('it cannot throw on the page it is added to', () => {
  // scrollRestoration is missing in older browsers and history can be blocked
  // outright in a locked-down one. A marketing page must not show an error
  // because a scroll helper did not work.
  const out = injectLandingScript(PAGE);
  assert.ok(out.includes('try{'));
  assert.ok(out.includes('catch(e){}'));
});
