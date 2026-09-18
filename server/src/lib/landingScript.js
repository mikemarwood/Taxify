// A little JavaScript on the landing page, put there by us rather than by the
// file.
//
// The page itself cannot carry a script. It is fetched from the hub before it
// is served, and the hub strips every script tag out of it — which is why the
// copyright year, the live price fetch and the click beacon written into
// landing.html have never run for a real visitor.
//
// This runs after that. serveLandingPage fetches the hub's HTML and then hands
// it through the injectors, so anything added here is added to a document the
// hub has already finished with. It is the same trick the advertisement films,
// the Facebook buttons and the Android download button use, and it is the only
// way a script reaches this page at all.
//
// Deliberately tiny, and it only does what cannot be done any other way. There
// is no build step here and nothing minifies it; every line has to earn its
// place in a page that a stranger is waiting to read.

const MARKER = '<!--LANDING-JS-->';

// Something only this script contains, used to decide whether it is already
// there. The marker alone could not answer that.
//
// The hub keeps a copy of this page and strips every script out of it. Our
// comment is not a script, so it survived — and the copy we then fetched back
// had the marker and no script in it. The guard saw the marker, concluded the
// work was done and returned the page untouched, so nothing here ran for
// anybody: not this, and not the scroll fix above it, which is the bug this
// file was written for in the first place.
//
// A sentinel inside the script body cannot outlive the script. A stale marker
// is stripped before the fresh one goes in, so a cached copy repairs itself.
const SENTINEL = 'taxifyLanding=1';

// Two things, and both of them only because this is the one place a script on
// this page runs at all.
//
// The first: the bar across the top is fixed and carries a ground, and gives
// it up at the very top where the hero is directly behind it — a bar with its
// own colour there would be a second band across a header meant to read as one
// field. That way round on purpose: with the class as the thing that *adds* the
// ground, a page where this never ran was pale text floating over white body
// copy. There is no CSS that can ask whether a page has scrolled, so this is
// the only way to do it at all — which is exactly why it must not be the thing
// legibility rests on.
//
// Opening at the top, which is where a page opens.
//
// Reported from a phone: the landing page reached from a Facebook advertisement
// opened scrolled to its foot. There is no fragment in the advertisement's URL,
// nothing in the served HTML calls scrollIntoView or scrollTo, and it does not
// reproduce in a desktop browser — which points at the one thing left, the
// browser restoring a scroll position of its own. In-app browsers are the worst
// offenders for it: Facebook and Instagram keep a page alive between visits and
// hand it back where it was left.
//
// scrollRestoration is the API for exactly that, and setting it to manual is
// the whole fix. The scroll to zero after it is the belt to that pair of
// braces, for a browser that has already restored by the time this runs.
//
// A fragment is left alone. Somebody following a link to #plans means to arrive
// at the plans, and this must not undo that.
const SCRIPT = `<script>
(function(){
  try{
    window.taxifyLanding=1;
    if('scrollRestoration' in history) history.scrollRestoration='manual';
    var bar=document.querySelector('.lp-topbar');
    if(bar){
      var mark=function(){ bar.classList.toggle('is-top', window.scrollY<=24); };
      mark();
      window.addEventListener('scroll',mark,{passive:true});
    }
    if(!location.hash){
      window.scrollTo(0,0);
      window.addEventListener('load',function(){ if(!location.hash) window.scrollTo(0,0); });
    }
  }catch(e){}
})();
</script>`;

// Appended at the end of the body, so nothing on the page waits for it.
//
// Falls back to appending at the end of the document when there is no closing
// body tag — the hub assembles its own markup and a missing one should mean a
// page without this rather than a page thrown away.
export function injectLandingScript(html) {
  let source = String(html || '');
  if (!source) return source;

  // Already here, for real — the sentinel lives inside the script.
  if (source.includes(SENTINEL)) return source;

  // A marker with no script behind it is the hub's stripper having been
  // through. Clear it, or the next check finds it and skips the work again.
  source = source.split(MARKER).join('');

  const block = MARKER + SCRIPT;
  const close = source.lastIndexOf('</body>');
  if (close === -1) return source + block;
  return source.slice(0, close) + block + source.slice(close);
}
