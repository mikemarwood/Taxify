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
export function cutEmptyAdSlots(html, present) {
  const live = Array.isArray(present) ? present : [];

  // Nothing uploaded at all: the whole section goes, heading and all.
  if (live.length === 0) {
    return html.replace(/<!--ADS-START-->[\s\S]*?<!--ADS-END-->/, '');
  }

  let out = html;
  for (const slot of AD_SLOTS) {
    if (live.includes(slot)) continue;
    // One film on its own is a single centred frame, not a frame and a gap.
    out = out.replace(new RegExp(`<!--SLOT:${slot}-->[\\s\\S]*?<!--/SLOT:${slot}-->`), '');
  }
  return out;
}
