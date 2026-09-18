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

// Two things, and both of them only because this is the one place a script on
// this page runs at all.
//
// The first: the bar across the top is fixed, and it is transparent while the
// hero is behind it — a bar with its own colour there would be a second band
// across a header that is meant to read as one field. Once the page has moved,
// what is behind it is body copy, so it takes a ground. A class toggled on
// scroll is the whole of it; there is no CSS that can ask "has this page
// scrolled".
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
    if('scrollRestoration' in history) history.scrollRestoration='manual';
    var bar=document.querySelector('.lp-topbar');
    if(bar){
      var mark=function(){ bar.classList.toggle('is-stuck', window.scrollY>24); };
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
  const source = String(html || '');
  if (!source || source.includes(MARKER)) return source;
  const block = MARKER + SCRIPT;
  const close = source.lastIndexOf('</body>');
  if (close === -1) return source + block;
  return source.slice(0, close) + block + source.slice(close);
}
