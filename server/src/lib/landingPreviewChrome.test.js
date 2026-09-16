import test from 'node:test';
import assert from 'node:assert/strict';
import { injectHubChrome } from './landingPreviewChrome.js';

const PAGE = '<!doctype html><html><head><title>T</title></head><body><main>Taxify</main></body></html>';

test('the footer and its styles land where they belong', () => {
  const out = injectHubChrome(PAGE);
  // Style in the head.
  assert.ok(out.indexOf('.mah-shell-footer {') < out.indexOf('</head>'));
  // Footer after the content and before the body closes. Matched on the tag
  // rather than the class name, which also appears in the stylesheet above —
  // searching for the bare class finds the CSS in the head and concludes the
  // footer is at the top of the page.
  assert.ok(out.indexOf('<footer class="mah-shell-footer">') > out.indexOf('<main>'));
  assert.ok(out.indexOf('<footer class="mah-shell-footer">') < out.indexOf('</body>'));
});

test('the hub navigation bar is not reproduced', () => {
  // It sat directly above Taxify's own bar: two dark bars, each with a brand
  // on the left and a blue button on the right, offering the same thing twice
  // before a word of the page had been read.
  const out = injectHubChrome(PAGE);
  assert.ok(!out.includes('mah-landing-nav'));
  assert.ok(!out.includes('padding-top: 68px'));
});

test('it goes in once, however many times the page is served', () => {
  const once = injectHubChrome(PAGE);
  assert.equal(injectHubChrome(once), once);
  assert.equal(once.split('<footer class="mah-shell-footer">').length - 1, 1);
});

test('a page missing its tags still gets the footer', () => {
  // A preview is worth more half-built than thrown away.
  const out = injectHubChrome('<div>no head, no body</div>');
  assert.ok(out.includes('mah-shell-footer'));
  assert.ok(out.includes('no head, no body'));
});

test('nothing in, nothing out', () => {
  assert.equal(injectHubChrome(''), '');
  assert.equal(injectHubChrome(null), '');
});

test('the copyright follows the clock rather than a year typed once', () => {
  assert.ok(injectHubChrome(PAGE).includes(String(new Date().getFullYear())));
});
