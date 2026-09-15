import test from 'node:test';
import assert from 'node:assert/strict';
import { injectHubChrome } from './landingPreviewChrome.js';

const PAGE = '<!doctype html><html><head><title>T</title></head><body><main>Taxify</main></body></html>';

test('the bar, the footer and the styles each land where they belong', () => {
  const out = injectHubChrome(PAGE);
  // Style in the head.
  assert.ok(out.indexOf('mah-landing-nav {') < out.indexOf('</head>'));
  // Bar straight after the body opens, before the page's own content.
  assert.ok(out.indexOf('<nav class="mah-landing-nav"') < out.indexOf('<main>'));
  // Footer after the content and before the body closes. Matched on the tag
  // rather than the class name, which also appears in the stylesheet above —
  // searching for the bare class finds the CSS in the head and concludes the
  // footer is at the top of the page.
  assert.ok(out.indexOf('<footer class="mah-shell-footer">') > out.indexOf('<main>'));
  assert.ok(out.indexOf('<footer class="mah-shell-footer">') < out.indexOf('</body>'));
});

test('it goes in once, however many times the page is served', () => {
  const once = injectHubChrome(PAGE);
  assert.equal(injectHubChrome(once), once);
  assert.equal(once.split('mah-landing-nav"').length - 1, 1);
});

test('a page missing its tags still gets the chrome', () => {
  // A preview is worth more half-built than thrown away.
  const out = injectHubChrome('<div>no head, no body</div>');
  assert.ok(out.includes('mah-landing-nav'));
  assert.ok(out.includes('mah-shell-footer'));
  assert.ok(out.includes('no head, no body'));
});

test('nothing in, nothing out', () => {
  assert.equal(injectHubChrome(''), '');
  assert.equal(injectHubChrome(null), '');
});

test('the body is pushed clear of a bar that is fixed', () => {
  // 68px of fixed navigation over the top of the page is 68px of hero nobody
  // can read, and the hub pads for it too.
  const out = injectHubChrome(PAGE);
  assert.ok(/body\s*\{\s*padding-top:\s*68px/.test(out));
});

test('the copyright follows the clock rather than a year typed once', () => {
  assert.ok(injectHubChrome(PAGE).includes(String(new Date().getFullYear())));
});
