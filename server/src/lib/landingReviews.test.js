import test from 'node:test';
import assert from 'node:assert/strict';
import { injectLandingReviews, hasReviews } from './landingReviews.js';

const withExampleOnly = `<header>x</header>
<!--REVIEWS-START-->
<!--REVIEWS-EMPTY-->
<section><div class="reviews">
<!-- <div class="review"><p class="review-quote">Their words.</p></div> -->
</div></section>
<!--REVIEWS-END-->
<footer>y</footer>`;

const withRealOne = `<header>x</header>
<!--REVIEWS-START-->
<section><div class="reviews">
<div class="review"><p class="review-quote">It paid for itself in an afternoon.</p></div>
</div></section>
<!--REVIEWS-END-->
<footer>y</footer>`;

test('an untouched section is removed entirely', () => {
  // A heading over an empty grid is worse than no section.
  const out = injectLandingReviews(withExampleOnly);
  assert.ok(!out.includes('REVIEWS-START'));
  assert.ok(!out.includes('class="reviews"'));
  assert.match(out, /<header>x<\/header>/);
  assert.match(out, /<footer>y<\/footer>/);
});

test('the example inside a comment does not count as a review', () => {
  // This is the one that matters: placeholder text must never reach the page.
  assert.equal(hasReviews(withExampleOnly), false);
});

test('a real review keeps the section', () => {
  assert.equal(hasReviews(withRealOne), true);
  const out = injectLandingReviews(withRealOne);
  assert.match(out, /It paid for itself in an afternoon/);
  assert.match(out, /class="reviews"/);
});

test('the empty marker wins even if a review has been pasted in above it', () => {
  // Half-finished edits stay invisible rather than shipping.
  const halfDone = withRealOne.replace('<!--REVIEWS-START-->', '<!--REVIEWS-START--><!--REVIEWS-EMPTY-->');
  assert.equal(hasReviews(halfDone), false);
  assert.ok(!injectLandingReviews(halfDone).includes('class="reviews"'));
});

test('a page with no markers at all is untouched', () => {
  const plain = '<p>nothing here</p>';
  assert.equal(injectLandingReviews(plain), plain);
  assert.equal(hasReviews(plain), false);
});
