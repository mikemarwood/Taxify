import { AD_SLOTS } from './landingAds.js';

// Cutting the empty advertisement slots out of the landing page.
//
// Kept apart from index.js so it can be tested. index.js opens a database
// connection on import, so nothing in it can be reached by a unit test, and
// this is exactly the sort of thing that has to be: two regular expressions
// over a page nobody looks at until a visitor does.
//
// It is done on the way out rather than in the page itself because the page has
// no JavaScript it can depend on — the hub proxy strips scripts — so a slot
// cannot hide itself. A <video> whose file is missing is a black box with a
// dead control bar, which is worse than no section at all.
//
// HTML comments do survive the proxy. That was measured against the live hub
// copy, not assumed.
export function cutEmptyAdSlots(html, present, withPoster) {
  const live = Array.isArray(present) ? present : [];
  const posters = Array.isArray(withPoster) ? withPoster : [];

  // Nothing uploaded at all: the whole section goes, heading and all.
  if (live.length === 0) {
    return html.replace(/<!--ADS-START-->[\s\S]*?<!--ADS-END-->/, '');
  }

  let out = html;
  for (const slot of AD_SLOTS) {
    if (!live.includes(slot)) {
      // One film on its own is a single centred frame, not a frame and a gap.
      out = out.replace(new RegExp(`<!--SLOT:${slot}-->[\\s\\S]*?<!--/SLOT:${slot}-->`), '');
      continue;
    }
    // No poster uploaded: fall back to the one drawn into the site.
    //
    // This used to delete the attribute, on the stated grounds that "without
    // one the browser paints the film's own opening frame". That is not true,
    // and believing it is what left two black rectangles on the landing page.
    // With preload="metadata", whether any frame gets painted is the browser's
    // discretion — often yes on a desktop Chrome, often no elsewhere, and
    // reported blank from several different devices.
    //
    // The attempt before this one was #t=0.1 on the source, which fails for a
    // reason worth recording: the fragment says where to seek, but
    // preload="metadata" will not fetch the sample data, so there is no
    // decoded frame at 0.1s for it to show.
    //
    // A poster is a plain image paint. No codec, no range request, no
    // discretion, identical on every device. media/ad-poster.jpg is committed
    // and ships with the site, unlike an uploaded poster, which lives under
    // uploads/ and would not exist on a fresh machine. An uploaded one still
    // wins wherever there is one.
    if (!posters.includes(slot)) {
      out = out.replace(` poster="/media/ads/${slot}-poster"`, ' poster="/media/ad-poster.jpg"');
    }
  }
  return out;
}
