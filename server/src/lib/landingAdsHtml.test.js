import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cutEmptyAdSlots } from './landingAdsHtml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real page, not a fixture. The markers are in landing.html and a fixture
// would go on passing after somebody edited them out of the page — which is the
// one failure this needs to catch.
const LANDING = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'landing.html'), 'utf8');

test('the page carries the markers this depends on', () => {
  assert.ok(LANDING.includes('<!--ADS-START-->'), 'ADS-START missing from landing.html');
  assert.ok(LANDING.includes('<!--ADS-END-->'), 'ADS-END missing from landing.html');
  for (const slot of ['ad-1', 'ad-2']) {
    assert.ok(LANDING.includes(`<!--SLOT:${slot}-->`), `SLOT:${slot} missing`);
    assert.ok(LANDING.includes(`<!--/SLOT:${slot}-->`), `/SLOT:${slot} missing`);
  }
});

test('nothing uploaded removes the whole section', () => {
  const out = cutEmptyAdSlots(LANDING, []);
  assert.ok(!out.includes('/media/ads/ad-1'));
  assert.ok(!out.includes('/media/ads/ad-2'));
  assert.ok(!out.includes('<!--ADS-START-->'));
  assert.ok(!out.includes('See it in action'));
  // The rest of the page is untouched — the cut is bounded by its markers.
  assert.ok(out.includes('</html>'));
  assert.ok(out.length < LANDING.length);
});

test('one film keeps its own frame and drops the other', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-2']);
  assert.ok(!out.includes('/media/ads/ad-1'), 'the empty slot should be gone');
  assert.ok(out.includes('/media/ads/ad-2'), 'the uploaded slot should stay');
  assert.ok(out.includes('See it in action'), 'the section stays for one film');
});

test('the other way round, so the loop is not just cutting the first', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-1']);
  assert.ok(out.includes('/media/ads/ad-1'));
  assert.ok(!out.includes('/media/ads/ad-2'));
});

// Everything uploaded, films and posters both: the page goes out as written.
test('both uploaded changes nothing at all', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-1', 'ad-2'], ['ad-1', 'ad-2']);
  assert.equal(out, LANDING);
});

// The cut is non-greedy and bounded, so a second marker pair later in the page
// could not be swallowed by the first. Checked on a synthetic page because the
// real one has only one.
test('a cut stops at its own closing marker', () => {
  const page = '<a><!--SLOT:ad-1-->one<!--/SLOT:ad-1-->KEEP<!--SLOT:ad-2-->two<!--/SLOT:ad-2--></a>';
  const out = cutEmptyAdSlots(page, ['ad-2']);
  assert.equal(out, '<a>KEEP<!--SLOT:ad-2-->two<!--/SLOT:ad-2--></a>');
});

test('an unrecognised slot name is ignored rather than cutting anything', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-1', 'ad-2', 'ad-99'], ['ad-1', 'ad-2', 'ad-99']);
  assert.equal(out, LANDING);
});

test('a page with no markers is returned untouched', () => {
  const page = '<html><body>nothing to do here</body></html>';
  assert.equal(cutEmptyAdSlots(page, []), page);
  assert.equal(cutEmptyAdSlots(page, ['ad-1']), page);
});

// A poster is optional, and the attribute has to go when there is no file —
// otherwise the browser requests a URL that 404s, for nothing.
test('the poster attribute is stripped when no poster was uploaded', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-1', 'ad-2'], []);
  assert.ok(!out.includes('poster="/media/ads/ad-1-poster"'));
  assert.ok(!out.includes('poster="/media/ads/ad-2-poster"'));
  // The films themselves are untouched.
  assert.ok(out.includes('/media/ads/ad-1'));
  assert.ok(out.includes('/media/ads/ad-2'));
});

test('a poster that was uploaded keeps its attribute', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-1', 'ad-2'], ['ad-1']);
  assert.ok(out.includes('poster="/media/ads/ad-1-poster"'));
  assert.ok(!out.includes('poster="/media/ads/ad-2-poster"'));
});

test('a cut slot takes its poster attribute with it', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-2'], ['ad-1', 'ad-2']);
  assert.ok(!out.includes('ad-1-poster'));
  assert.ok(out.includes('poster="/media/ads/ad-2-poster"'));
});

// Omitting the third argument has to keep meaning "no posters", so an older
// caller cannot leave a 404 behind.
test('no poster list means no posters', () => {
  const out = cutEmptyAdSlots(LANDING, ['ad-1']);
  assert.ok(!out.includes('ad-1-poster'));
});

test('the poster is absolute, because the hub does not rewrite that attribute', () => {
  // The bug this exists to stop coming back. The proxy rewrites relative URLs
  // to absolute for link[href], img[src], img[srcset], source[src],
  // source[srcset], script[src], video[src] and a[href] — and video[poster] is
  // not on that list. A relative poster therefore resolved against the hub's
  // own origin, 404'd, and every visitor got a blank frame with a dead control
  // bar. Verified by reading the attribute back off the proxied page.
  const page =
    '<!--ADS-START--><!--SLOT:ad-1--><video poster="/media/ads/ad-1-poster">' +
    '<source src="/media/ads/ad-1"></video><!--/SLOT:ad-1--><!--ADS-END-->';

  const out = cutEmptyAdSlots(page, ['ad-1'], [], 'https://taxify.example');
  assert.match(out, /poster="https:\/\/taxify\.example\/media\/ad-poster\.jpg"/);
  assert.ok(!/poster="\/media/.test(out), 'nothing relative survives');
});

test('an uploaded poster is made absolute too', () => {
  const page =
    '<!--ADS-START--><!--SLOT:ad-1--><video poster="/media/ads/ad-1-poster">' +
    '<source src="/media/ads/ad-1"></video><!--/SLOT:ad-1--><!--ADS-END-->';

  const out = cutEmptyAdSlots(page, ['ad-1'], ['ad-1'], 'https://taxify.example/');
  assert.match(out, /poster="https:\/\/taxify\.example\/media\/ads\/ad-1-poster"/);
  assert.ok(!/poster="\/media/.test(out));
});

test('with no origin known, the fallback poster is still used', () => {
  // publicOrigin() can be empty on a machine that has not been told its own
  // address. A relative poster is wrong through the proxy but right when
  // Taxify serves the page itself, so it is the safer of the two.
  const page =
    '<!--ADS-START--><!--SLOT:ad-1--><video poster="/media/ads/ad-1-poster">' +
    '<source src="/media/ads/ad-1"></video><!--/SLOT:ad-1--><!--ADS-END-->';

  const out = cutEmptyAdSlots(page, ['ad-1'], [], '');
  assert.match(out, /poster="\/media\/ad-poster\.jpg"/);
});
