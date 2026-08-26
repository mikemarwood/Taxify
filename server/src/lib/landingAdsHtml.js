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
export function cutEmptyAdSlots(html, present, withPoster, origin) {
  const live = Array.isArray(present) ? present : [];
  const posters = Array.isArray(withPoster) ? withPoster : [];
  // Absolute, because the hub does not rewrite this one.
  //
  // Its proxy rewrites relative URLs to absolute for link[href], img[src],
  // img[srcset], source[src], source[srcset], script[src], video[src] and
  // a[href] — and that list does not include video[poster]. So a relative
  // poster resolves against the hub's own origin, where the file does not
  // exist. Checked by fetching the proxied page and reading the attribute
  // back, not assumed. Only reached when somebody has uploaded a poster; see
  // below for why there is no longer a fallback one.
  const base = String(origin || '').replace(/\/$/, '');

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
    // No poster uploaded: the attribute goes, and the film shows its own
    // opening frame.
    //
    // Which it does. That was the original behaviour here, I replaced it with a
    // drawn fallback poster on the theory that painting a first frame was "the
    // browser's discretion", and the theory was wrong. Measured rather than
    // argued about the third time: Edge headless, this exact markup, a magenta
    // page behind the video so anything unpainted would be unmistakable. Both
    // films painted their real first frame and covered the ground completely.
    //
    // The blank frames were never about the first frame at all. The hub served
    // this page with no media-src in its CSP, so media fell back to
    // default-src 'self' — and 'self' is the hub's origin, not ours. The
    // browser refused to fetch the films before a request left. Every attempt
    // made here (faststart, then #t=0.1, then the poster) was working on the
    // wrong problem, and the drawn poster made it worse: it had a play button
    // painted into it, so each film appeared to have two, and the prominent
    // one was a picture that could not be clicked.
    //
    // An uploaded poster still wins where somebody has set one.
    if (!posters.includes(slot)) {
      out = out.replace(` poster="/media/ads/${slot}-poster"`, '');
    } else if (base) {
      out = out.replace(` poster="/media/ads/${slot}-poster"`, ` poster="${base}/media/ads/${slot}-poster"`);
    }
  }
  return out;
}
