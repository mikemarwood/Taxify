// Keeping the reviews section off the page until there is a review.
//
// The block between REVIEWS-START and REVIEWS-END carries a REVIEWS-EMPTY
// marker while it holds nothing but the commented-out example. The server
// removes the whole section while that marker is there, so the page cannot
// ship a heading with an empty grid under it — and cannot ship placeholder
// quotes either, which is the failure this is really guarding against.
//
// Deliberately not a database and not an admin screen. There will be a handful
// of these and they change rarely; editing landing.html is less machinery than
// a table, a route and a form, and the marker means a half-finished edit is
// invisible rather than embarrassing.

export const EMPTY_MARKER = '<!--REVIEWS-EMPTY-->';

// Whether the section currently holds a real review.
//
// A review only counts once it is out of the example comment, so the check is
// for review markup that is not inside an HTML comment.
export function hasReviews(html) {
  const block = /<!--REVIEWS-START-->([\s\S]*?)<!--REVIEWS-END-->/.exec(html);
  if (!block) return false;
  if (block[1].includes(EMPTY_MARKER)) return false;
  // Strip comments, then look for a review that survived.
  const live = block[1].replace(/<!--[\s\S]*?-->/g, '');
  return /class="review"/.test(live);
}

export function injectLandingReviews(html) {
  const markers = /<!--REVIEWS-START-->[\s\S]*?<!--REVIEWS-END-->\s*/;
  if (!markers.test(html)) return html;
  return hasReviews(html) ? html : html.replace(markers, '');
}
