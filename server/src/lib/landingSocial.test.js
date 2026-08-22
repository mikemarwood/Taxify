import test from 'node:test';
import assert from 'node:assert/strict';
import { injectLandingSocial, socialButtonsHtml, safeHttpUrl } from './landingSocial.js';

const PAGE = '<header>x</header><!--SOCIAL-START--><!--SOCIAL-END--><footer>y</footer>';

test('puts the buttons between the markers', () => {
  const out = injectLandingSocial(PAGE, { enabled: true, shareUrl: 'https://taxify.example' });
  assert.match(out, /sharer\.php/);
  assert.match(out, /plugins\/like\.php/);
  assert.match(out, /<header>x<\/header>/);
  assert.match(out, /<footer>y<\/footer>/);
});

test('takes the block out entirely when Facebook is switched off', () => {
  const out = injectLandingSocial(PAGE, { enabled: false, shareUrl: 'https://taxify.example' });
  assert.equal(out, '<header>x</header><footer>y</footer>');
});

test('takes it out when no share address has been set', () => {
  // An empty row still takes its margin and reads as something that failed.
  assert.equal(injectLandingSocial(PAGE, { enabled: true, shareUrl: '' }), '<header>x</header><footer>y</footer>');
  assert.equal(injectLandingSocial(PAGE, { enabled: true }), '<header>x</header><footer>y</footer>');
  assert.equal(injectLandingSocial(PAGE, null), '<header>x</header><footer>y</footer>');
});

test('leaves a page without the markers alone', () => {
  const plain = '<p>no markers here</p>';
  assert.equal(injectLandingSocial(plain, { enabled: true, shareUrl: 'https://taxify.example' }), plain);
});

test('refuses a URL that is not http or https', () => {
  // This lands in an iframe src and an href on a public page, so a
  // javascript: URL typed into the admin settings must not reach either.
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeHttpUrl('not a url'), null);
  assert.equal(safeHttpUrl(''), null);
  assert.equal(safeHttpUrl(null), null);
});

test('a rejected URL takes the whole block with it', () => {
  const out = injectLandingSocial(PAGE, { enabled: true, shareUrl: 'javascript:alert(1)' });
  assert.equal(out, '<header>x</header><footer>y</footer>');
});

test('escapes the address rather than trusting it', () => {
  const html = socialButtonsHtml({ shareUrl: 'https://taxify.example/?a=1&b=2' });
  assert.ok(!html.includes('"><script'), 'no way out of the attribute');
  // Encoded once for the query string it sits in.
  assert.match(html, /href=https%3A%2F%2Ftaxify\.example%2F%3Fa%3D1%26b%3D2/);
});

test('adds a follow link only when a page address is given', () => {
  const without = socialButtonsHtml({ shareUrl: 'https://taxify.example' });
  assert.ok(!without.includes('Follow us'));
  const with_ = socialButtonsHtml({ shareUrl: 'https://taxify.example', pageUrl: 'https://facebook.com/taxify' });
  assert.match(with_, /Follow us/);
});

test('ignores a follow address that is not a real URL', () => {
  const html = socialButtonsHtml({ shareUrl: 'https://taxify.example', pageUrl: 'javascript:alert(1)' });
  assert.ok(!html.includes('Follow us'));
  assert.ok(!html.includes('javascript:'));
});

test('the like button is an iframe, not a script', () => {
  // The hub proxy strips every script from this page, so the SDK version of
  // this button would silently render nothing at all.
  const html = socialButtonsHtml({ shareUrl: 'https://taxify.example' });
  assert.match(html, /<iframe/);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('connect.facebook.net'));
});
