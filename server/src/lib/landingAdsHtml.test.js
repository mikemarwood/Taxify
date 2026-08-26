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

test('no uploaded poster means no poster attribute, so the film shows its own frame', () => {
  // A <video> with preload="metadata" and no poster paints its own opening
  // frame. Measured, not assumed: Edge headless, the real landing markup, a
  // magenta page behind the video so anything unpainted would be obvious —
  // both films covered it completely with their first frame.
  //
  // A drawn fallback poster stood here for a while, on the theory that
  // painting a frame was the browser's discretion. It was not, and the poster
  // had a play button painted into it, so every film appeared to have two and
  // the prominent one could not be clicked.
  const page =
    '<!--ADS-START--><!--SLOT:ad-1--><video poster="/media/ads/ad-1-poster">' +
    '<source src="/media/ads/ad-1"></video><!--/SLOT:ad-1--><!--ADS-END-->';

  const out = cutEmptyAdSlots(page, ['ad-1'], [], 'https://taxify.example');
  assert.ok(!out.includes('poster='), 'the attribute is gone entirely');
  assert.ok(!out.includes('ad-poster.jpg'), 'and no drawn fallback is referenced');
  assert.match(out, /<source src="\/media\/ads\/ad-1">/);
});

test('an uploaded poster is made absolute too', () => {
  const page =
    '<!--ADS-START--><!--SLOT:ad-1--><video poster="/media/ads/ad-1-poster">' +
    '<source src="/media/ads/ad-1"></video><!--/SLOT:ad-1--><!--ADS-END-->';

  const out = cutEmptyAdSlots(page, ['ad-1'], ['ad-1'], 'https://taxify.example/');
  assert.match(out, /poster="https:\/\/taxify\.example\/media\/ads\/ad-1-poster"/);
  assert.ok(!/poster="\/media/.test(out));
});

test('an uploaded poster with no known origin stays relative rather than broken', () => {
  // publicOrigin() can be empty on a machine that has not been told its own
  // address. Relative is wrong through the proxy but right when Taxify serves
  // the page itself, so it is the safer of the two to leave in place.
  const page =
    '<!--ADS-START--><!--SLOT:ad-1--><video poster="/media/ads/ad-1-poster">' +
    '<source src="/media/ads/ad-1"></video><!--/SLOT:ad-1--><!--ADS-END-->';

  const out = cutEmptyAdSlots(page, ['ad-1'], ['ad-1'], '');
  assert.match(out, /poster="\/media\/ads\/ad-1-poster"/);
});
