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

test('it sets the title, because the hub replaces ours', () => {
  // landing.html carries a <title> that never reaches anybody: the proxy serves
  // the page under "Taxify — Mikes App Hub". This is the only code that runs
  // after the proxy has finished with the document.
  const out = injectLandingScript(PAGE);
  assert.match(out, /document\.title=/);
  assert.match(out, /Receipt & expense tracker for Australian tax time/);
});

test('the title is a JSON string, so an apostrophe cannot end it', () => {
  // Written into a script tag by hand. A quote in the title would close the
  // string and leave a syntax error where the whole script used to be.
  const out = injectLandingScript(PAGE);
  const at = out.indexOf('document.title=');
  const set = out.slice(at + 'document.title='.length, out.indexOf(';', at));
  assert.ok(at !== -1, 'the title should be assigned');
  assert.doesNotThrow(() => JSON.parse(set));
});
