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
//
// It plays with sound where the device permits it. That is not everywhere —
// see the play attempt below — so nothing in the film may depend on being
// heard.
//
// Two shapes, because the two places it appears are not the same place.
//
// On the web it fills the pane the sign-in form sits in and leaves the brand
// rail beside it alone: the rail is what tells somebody whose site they have
// landed on, and blacking out the whole window to introduce a product hides
// the product's name while doing it. Below 900px the rail is not drawn at all,
// so the pane is the window and the effect is the same either way.
//
// In the Android app there is no such frame — it can open on any page — so
// there it covers everything.

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
export default function LoginIntro({ onDone, armed = true, variant = 'cover' }) {
  const [playing, setPlaying] = useState(() => armed && !introAlreadySeen());
  const [leaving, setLeaving] = useState(false);
  // How far through the whole wait we are, 0–100.
  //
  // A bar that fills and finishes says how long is left; one that sweeps back
  // and forth only says "still working". This is the same reasoning — and the
  // same bar — as the boot splash in index.html that hands over to it.
  const [percent, setPercent] = useState(0);
  const videoRef = useRef(null);
  const timers = useRef([]);
  const endedAt = useRef(null);

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

    // With sound if the device will allow it, silently if it will not.
    //
    // A browser refuses to autoplay audio at somebody who has not asked for
    // it, and loading a page is not asking — so an unmuted play() is rejected
    // outright on a first visit, which would mean no film at all rather than a
    // quiet one. Chrome relaxes this once a site has enough of a history with
    // the person, and the Android WebView allows it because Capacitor turns
    // the gesture requirement off, so unmuted is worth attempting rather than
    // assuming.
    //
    // Attempted first, then retried muted on the rejection. The order matters:
    // muting after a successful unmuted start would silence the one case this
    // is for, and the retry is what guarantees the film plays either way.
    const video = videoRef.current;
    if (!video) return undefined;

    video.muted = false;
    video.volume = 1;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(finish);
    });

    // The figure under it, ten times a second.
    //
    // Two things are being waited for and they are one wait to whoever is
    // watching, so they are one number: first the file arriving, then the film
    // running, then the pause on the closing frame. Before playback starts it
    // reports how much has downloaded, held short of full so it cannot sit on
    // 100% with nothing happening; after that it is elapsed time over the
    // whole run, and it reaches 100 exactly as the form appears.
    const total = () => (Number.isFinite(video.duration) ? video.duration : 10) + HOLD_MS / 1000;
    const tick = () => {
      let value;
      if (endedAt.current) {
        const held = (Date.now() - endedAt.current) / 1000;
        value = ((video.duration || 10) + held) / total();
      } else if (video.currentTime > 0) {
        value = video.currentTime / total();
      } else {
        const buffered = video.buffered?.length ? video.buffered.end(video.buffered.length - 1) : 0;
        const size = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
        value = Math.min(buffered / size, 0.95) * 0.15;
      }
      setPercent(Math.max(0, Math.min(100, Math.round(value * 100))));
    };
    tick();
    const ticker = setInterval(tick, 100);

    const list = timers.current;
    return () => {
      clearInterval(ticker);
      list.forEach(clearTimeout);
      list.length = 0;
    };
    // Deliberately only on the first run: this sets the film going, and
    // re-running it would start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (!playing) return null;

  const pane = variant === 'pane';

  const stage = (
    <div
      aria-label="Taxify is loading"
      role="img"
      style={{
        // In the pane it fills the section it is rendered into, which is what
        // leaves the brand rail beside it visible. As a cover it takes the
        // window.
        position: pane ? 'absolute' : 'fixed',
        inset: 0,
        // Above everything when it covers; above the form and nothing else
        // when it does not.
        zIndex: pane ? 30 : 4000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(16px, 3.5vh, 30px)',
        padding: 'clamp(16px, 4vw, 40px)',
        // Two grounds, for the two shapes.
        //
        // As a cover it takes the gradient the boot splash, the native Android
        // splash and the maintenance screen all use, so the handover between
        // them is invisible.
        //
        // In the pane it takes the pane's own paper instead. The first attempt
        // used the gradient there too and the result defeated the point of
        // sitting in the pane at all: the rail is navy, the stage was navy,
        // and the two merged into one dark field with no sign there was a
        // sidebar to see. Keeping the page's light half light is what makes
        // the split still read as a split — and it lets the film sit on it as
        // a framed object rather than as a hole cut in the page.
        background: pane ? 'var(--bg-card)' : 'linear-gradient(180deg, #10294c 0%, #143257 55%, #0d2444 100%)',
        color: pane ? 'var(--text)' : '#eaf1fb',
        opacity: leaving ? 0 : 1,
        transition: 'opacity 0.4s ease',
        // Nothing underneath is reachable, and nothing here is pressable.
        cursor: 'default',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* No autoPlay and no muted attribute.
          
          Both are set by the effect above instead, so there is exactly one
          attempt sequence. Declaring autoPlay muted here would have the
          browser start it silently before the effect ran, and unmuting a video
          that is already playing without a gesture behind it is refused by
          some browsers by pausing it — which is the one outcome worse than
          either sound or silence. */}
      <video
        ref={videoRef}
        src="/media/intro.mp4"
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
        onEnded={() => {
          endedAt.current = Date.now();
          const id = setTimeout(finish, HOLD_MS);
          timers.current.push(id);
        }}
        onError={finish}
        style={{
          width: '100%',
          maxWidth: 620,
          // Room left under it for the line below, rather than the two
          // fighting over the same space on a short window.
          maxHeight: '68%',
          minHeight: 0,
          flex: '0 1 auto',
          // Contained rather than cropped: it is a title card, and cropping a
          // title card cuts the title.
          objectFit: 'contain',
          // A framed object on the page rather than a rectangle laid over it.
          // The ground behind it is the film's own, so it shows through the
          // letterboxing on a shape that is not sixteen by nine.
          borderRadius: 14,
          background: '#0a1424',
          boxShadow: pane ? '0 24px 54px -22px rgba(9, 20, 40, 0.55)' : 'none',
          // No clicks, no double-tap seek, no long-press menu.
          pointerEvents: 'none',
        }}
      />

      {/* Under it, on every size.
          
          Somebody who arrives to find something moving where they expected a
          sign-in form needs to be told it is on its way — and told in a way
          that will finish. It says loading rather than naming what is playing,
          because what is playing is not the point: the wait is.
          
          Label and figure on one line above the track, rather than stacked in
          a centred column of three. A column of three short things reads as a
          list of three things; a line with a label at one end and its number
          at the other reads as one statement, and the track underneath belongs
          to both ends of it. */}
      <div
        style={{
          width: 'min(320px, 78%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: 0.2 }}>Taxify is loading</span>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: pane ? 'var(--accent)' : '#7cb8ff',
              fontVariantNumeric: 'tabular-nums',
              // The digits do not shuffle the label about as they change.
              minWidth: 38,
              textAlign: 'right',
            }}
          >
            {percent}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{
            height: 4,
            borderRadius: 999,
            overflow: 'hidden',
            background: pane ? 'var(--bg-inset)' : 'rgba(234, 241, 251, 0.14)',
            // Set into the ground rather than sitting on it, so the empty part
            // of the track is a groove and the filled part is what catches the
            // light.
            boxShadow: pane ? 'inset 0 1px 2px rgba(0, 0, 0, 0.12)' : 'inset 0 1px 2px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div
            className="intro-fill"
            style={{
              width: `${percent}%`,
              height: '100%',
              borderRadius: 999,
              background: pane
                ? 'linear-gradient(90deg, var(--accent) 0%, var(--accent) 70%, #a9d2ff 100%)'
                : 'linear-gradient(90deg, #4f8fe0 0%, #7cb8ff 60%, #a9d2ff 100%)',
              boxShadow: pane ? 'none' : '0 0 12px rgba(124, 184, 255, 0.55)',
              transition: 'width 0.25s ease-out',
            }}
          />
        </div>
      </div>

      {/* A sheen travelling along the filled part.
          
          The bar can sit on the same figure for a second or two while a chunk
          of the file arrives, and a still bar during a wait is indistinguishable
          from a stuck one. This keeps something moving without pretending to
          progress that has not happened — the width is still the only thing
          that says how far along it is.
          
          Off entirely for anybody who has asked for less motion; the number
          and the width say it all without this. */}
      <style>{`
        .intro-fill { position: relative; overflow: hidden; }
        .intro-fill::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.5) 50%, transparent 100%);
          transform: translateX(-100%);
          animation: intro-sheen 1.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .intro-fill::after { animation: none; opacity: 0; }
        }
        @keyframes intro-sheen {
          to { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );

  // The pane one belongs where it was rendered — inside the section it is
  // covering — so it cannot be portalled anywhere.
  return pane ? stage : createPortal(stage, document.body);
}
