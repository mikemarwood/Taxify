import test from 'node:test';
import assert from 'node:assert/strict';
import { injectLandingSocial, socialButtonsHtml, safeHttpUrl, onCurrentHost } from './landingSocial.js';

const PAGE = '<header>x</header><!--SOCIAL-START--><!--SOCIAL-END--><footer>y</footer>';

test('puts the buttons between the markers', () => {
  const out = injectLandingSocial(PAGE, { enabled: true, shareUrl: 'https://taxify.example' });
  assert.match(out, /sharer\.php/);
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
  assert.match(html, /u=https%3A%2F%2Ftaxify\.example%2F%3Fa%3D1%26b%3D2/);
});

test('adds a follow link only when a page address is given', () => {
  const without = socialButtonsHtml({ shareUrl: 'https://taxify.example' });
  assert.ok(!without.includes('Follow us'));
  const with_ = socialButtonsHtml({ shareUrl: 'https://taxify.example', pageUrl: 'https://facebook.com/taxify' });
  assert.match(with_, /Follow us/);
});

test('every button carries an icon', () => {
  // A bare word beside two buttons with glyphs reads as an unfinished link
  // rather than the third button in a set.
  const html = socialButtonsHtml({ shareUrl: 'https://taxify.example', pageUrl: 'https://facebook.com/taxify' });
  assert.equal(html.match(/<a class="social-btn/g).length, 3);
  assert.equal(html.match(/<svg /g).length, 3);
});

test('the ampersand in the share link is written as an entity', () => {
  // A bare & in an href is a character reference waiting to happen — this one
  // is a letter away from &quot, and only the "e" after it stops the parser
  // matching. There should be no bare ampersand in the markup at all.
  const html = socialButtonsHtml({ shareUrl: 'https://taxify.example' });
  assert.match(html, /sharer\.php\?u=[^"]*&amp;quote=/);
  assert.ok(!/&(?!amp;|quot;|lt;|gt;)/.test(html), 'no unescaped ampersand');
});

test('ignores a follow address that is not a real URL', () => {
  const html = socialButtonsHtml({ shareUrl: 'https://taxify.example', pageUrl: 'javascript:alert(1)' });
  assert.ok(!html.includes('Follow us'));
  assert.ok(!html.includes('javascript:'));
});

test('every button is a plain link — no iframe, no script', () => {
  // Both would be thrown away before a visitor saw them. The hub proxy strips
  // every script from this page, so Facebook's SDK renders nothing; and it
  // serves the page under "default-src 'self'" with no frame-src, so an
  // iframe onto facebook.com is refused by the browser before a request goes
  // out. That is what the Like button was, and why it is gone: it showed as a
  // small empty gap beside the buttons that work.
  const html = socialButtonsHtml({ shareUrl: 'https://taxify.example' });
  assert.ok(!html.includes('<iframe'), 'an iframe would be blocked by the proxy CSP');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('connect.facebook.net'));
  assert.ok(!html.includes('plugins/like.php'));
  assert.match(html, /sharer\.php/);
});

test('a share address left on the old domain is moved to the current one', () => {
  // The address is a stored setting, so one typed before the move outlives it
  // and goes on sending everybody who presses Share to the old name. That name
  // still resolves, which is why nobody would ever report it.
  assert.equal(
    onCurrentHost('https://taxify.mikesapphub.com', 'https://taxify.net.au'),
    'https://taxify.net.au/'
  );
});

test('moving the host keeps the path somebody chose', () => {
  assert.equal(
    onCurrentHost('https://taxify.mikesapphub.com/pricing?a=1', 'https://taxify.net.au'),
    'https://taxify.net.au/pricing?a=1'
  );
});

test('an address already on the current domain is left alone', () => {
  assert.equal(onCurrentHost('https://taxify.net.au/x', 'https://taxify.net.au'), 'https://taxify.net.au/x');
});

test('somewhere else entirely is left alone', () => {
  // Only the addresses this site has actually retired are rewritten. Pointing
  // Share at a different site is unusual but it is not ours to correct.
  assert.equal(onCurrentHost('https://example.com/x', 'https://taxify.net.au'), 'https://example.com/x');
});

test('rubbish in is still null out', () => {
  assert.equal(onCurrentHost('javascript:alert(1)', 'https://taxify.net.au'), null);
  assert.equal(onCurrentHost('', 'https://taxify.net.au'), null);
  assert.equal(onCurrentHost(null, 'https://taxify.net.au'), null);
});
