import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The animation that plays over the sign-in page, once.
//
// Once is the whole design. A ten-second film in front of the form is a
// welcome the first time and an obstacle every time after, so this remembers
// that it has played and never asks again — and it remembers it the moment it
// starts rather than when it finishes, because somebody who reloads midway
// through must not be handed the same ten seconds again.
//
// In the Android app the rule is per build instead: a new install has nothing
// remembered, and an update changes the version the marker was written for, so
// the film plays again for what is genuinely a new thing. On the web there is
// no such event — a deploy is not something a customer did — so there it is
// once and only once.
//
// Nothing can be pressed. No controls, no scrubbing, no pause, no skip: the
// element itself takes no pointer events, the browser's own controls are off,
// and the context menu that offers Download and Playback speed is refused. The
// only way through it is to wait, and it is short.

const SEEN_KEY = 'taxify.intro.seen';

// How long to hold on the closing frame before handing over the page.
//
// The film ends on its title, and cutting to a login form on the same frame it
// lands reads as an interruption rather than an ending. Four seconds is long
// enough to read what it finishes on and short enough that nobody wonders
// whether it has hung.
const HOLD_MS = 4000;

// A ceiling on the whole thing, in case `ended` never arrives — a stalled
// download, a codec the device will not decode, a tab backgrounded at the
// wrong moment. The film is ten seconds; this is generous and still bounded,
// because the one unacceptable outcome is somebody sitting in front of a black
// rectangle with no way to reach the form.
const GIVE_UP_MS = 22000;

// Which build is running, when this is the Android app.
//
// Capacitor appends TaxifyAndroid/<versionCode> to the user agent — the same
// marker AppUpdateBanner reads to decide whether an update is waiting. A
// browser never matches, and gets the plain once-ever marker instead.
function buildMarker() {
  return isAndroidApp() ? `android-${androidBuild()}` : 'web';
}

export function isAndroidApp() {
  return typeof navigator !== 'undefined' && /TaxifyAndroid/i.test(navigator.userAgent || '');
}

function androidBuild() {
  const match = /TaxifyAndroid\/(\d+)/i.exec(navigator.userAgent || '');
  // A bare marker is the build that shipped before the number was appended.
  return match ? match[1] : '1';
}

// Whether this browser or build has already been shown it.
//
// Wrapped, because localStorage throws rather than returning null in a private
// window on some browsers, and a storage that cannot be read is not a reason to
// refuse somebody their sign-in page. On a throw it reports "already seen",
// which fails towards showing nothing — the safe direction for a thing that
// covers the form.
export function introAlreadySeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === buildMarker();
  } catch {
    return true;
  }
}

function rememberSeen() {
  try {
    localStorage.setItem(SEEN_KEY, buildMarker());
  } catch {
    // Nothing to do. It plays again next time, which is a small cost.
  }
}

// `armed` is what decides whether this is the right moment to play at all.
//
// In a browser that is the sign-in page and nowhere else: it is the page a new
// customer arrives on, and a film in front of the expense they were halfway
// through entering would be an ambush. In the app there is no such page to
// wait for — somebody who stays signed in never sees sign-in again — so the
// moment is the launch itself, whatever it opens on.
export default function LoginIntro({ onDone, armed = true }) {
  const [playing, setPlaying] = useState(() => armed && !introAlreadySeen());
  const [leaving, setLeaving] = useState(false);
  const videoRef = useRef(null);
  const timers = useRef([]);

  // One way out, however it is reached — the end of the film, an error, or the
  // ceiling above. Called more than once is harmless.
  const finish = useCallback(() => {
    setLeaving(true);
    const id = setTimeout(() => {
      setPlaying(false);
      onDone?.();
    }, 420);
    timers.current.push(id);
  }, [onDone]);

  // Armed a moment after mounting, which is the ordinary case in a browser.
  //
  // The app root renders before the router has settled on a route, so the
  // first pathname a browser sees can be "/" for a render or two before the
  // redirect to sign-in lands. Reading `armed` only in the state initialiser
  // meant a customer arriving at the site was judged not to be on the sign-in
  // page, and never saw it. There is no loop here: once it has played,
  // introAlreadySeen is true and this stops firing.
  useEffect(() => {
    if (armed && !playing && !introAlreadySeen()) setPlaying(true);
  }, [armed, playing]);

  useEffect(() => {
    // onDone is not called here. finish() is the one exit, and calling it from
    // a branch that runs on every idle render would fire it repeatedly before
    // anything had even played.
    if (!playing) return undefined;

    rememberSeen();
    const bail = setTimeout(finish, GIVE_UP_MS);
    timers.current.push(bail);

    // Muted, because that is the only kind of autoplay a browser allows
    // without a gesture, and a sign-in page that makes a noise at somebody is
    // worse than a silent one. Played explicitly as well as declared, since
    // the attribute alone is not always enough on a page that has just loaded.
    const video = videoRef.current;
    video?.play?.().catch(() => finish());

    const list = timers.current;
    return () => {
      list.forEach(clearTimeout);
      list.length = 0;
    };
    // Deliberately only on the first run: this sets the film going, and
    // re-running it would start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (!playing) return null;

  return createPortal(
    <div
      aria-label="Taxify"
      role="img"
      style={{
        position: 'fixed',
        inset: 0,
        // Above everything, including the wall display and the camera sheet.
        // It covers the sign-in form by design, and there is nothing on this
        // page it should sit behind.
        zIndex: 4000,
        display: 'grid',
        placeItems: 'center',
        background: '#000',
        opacity: leaving ? 0 : 1,
        transition: 'opacity 0.4s ease',
        // Nothing underneath is reachable, and nothing here is pressable.
        cursor: 'default',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        src="/media/intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
        onEnded={() => {
          const id = setTimeout(finish, HOLD_MS);
          timers.current.push(id);
        }}
        onError={finish}
        style={{
          width: '100%',
          height: '100%',
          // Contained rather than cropped: it is a title card, and cropping a
          // title card cuts the title.
          objectFit: 'contain',
          // No clicks, no double-tap seek, no long-press menu.
          pointerEvents: 'none',
        }}
      />
    </div>,
    document.body
  );
}
