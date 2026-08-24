import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// Photographing a receipt without leaving the app.
//
// The reason this exists rather than `<input capture="environment">` is the
// lens. That attribute is the right thing on the web, but inside the Android
// app it is thrown away: Capacitor reads `capture` as a yes/no — "the page
// wants the camera" — and builds a bare ACTION_IMAGE_CAPTURE intent carrying
// nothing but an output path. Which lens opens is then entirely the camera
// app's business, and plenty of them default to the front one or to whichever
// was used last. The Capacitor Camera plugin does not help either; its own
// documentation says `direction` is iOS and Web only, and its Android code
// builds the same bare intent.
//
// getUserMedia does honour it. `facingMode: environment` picks the rear lens,
// it behaves the same in the app and in a mobile browser, and it is ordinary
// web code rather than native code that can only be tested by shipping it.
//
// Capacitor grants the permission for us: a VIDEO_CAPTURE request from the
// webview is turned into a runtime CAMERA prompt and granted through to the
// page. That does mean android.permission.CAMERA has to be declared, which it
// now is — see the note in AndroidManifest.xml about what that changes.
//
// Anything that goes wrong here — no camera, permission refused, an API that
// is not there — calls onFallback, and the caller opens the old file input.
// A receipt that cannot be photographed must still be attachable.

const JPEG_QUALITY = 0.9;

// Remembered for the session once the in-app camera has failed to start.
//
// It fails for a whole install at a time, not now and then: the app was built
// before android.permission.CAMERA was declared, so Android will not even
// offer the prompt and getUserMedia is refused every time. Without this the
// overlay opens, goes black, and closes again on every attempt before handing
// over — a flicker that looks like a bug rather than a fallback.
let unavailable = false;

export function inAppCameraUnavailable() {
  return unavailable;
}

export default function CameraCapture({ onCapture, onCancel, onFallback, onChooseFile }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    // Every track, or the camera light stays on after the sheet has gone.
    stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onFallback('This browser cannot open the camera directly.');
        return;
      }
      try {
        // `ideal` rather than `exact`: on a device with only one camera, exact
        // throws OverconstrainedError and we would fall back for no reason.
        // Ideal asks for the rear lens and settles for what there is.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (err) {
        if (cancelled) return;

        // Hand over to the phone's own camera app, whatever went wrong.
        //
        // This used to stop on a refusal and offer to pick a file, which was
        // the wrong answer twice over. The phone has a camera app that takes
        // photos under its own permission and needs nothing from us — so
        // somebody who asked for a camera can still have one. And on the
        // build that is installed today a refusal is not a decision anybody
        // made: android.permission.CAMERA was declared after that APK was
        // cut, so Android refuses without ever asking, and telling the owner
        // to allow it in their settings sent them looking for a switch that
        // is not there.
        //
        // Silent, because the outcome is a camera opening either way. The one
        // thing lost is the guarantee of the rear lens, which is what the next
        // APK restores.
        console.warn('In-app camera unavailable, using the system camera instead:', err?.name || err);
        unavailable = true;
        onFallback('');
      }
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [onFallback, stop]);

  function shoot() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);

    // The sensor's own size, not the size it happens to be displayed at, so a
    // receipt stays readable after it has been filed.
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setBusy(false);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setBusy(false);
          setError('The photo could not be saved. Try again, or choose a file instead.');
          return;
        }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        stop();
        onCapture(new File([blob], `receipt-${stamp}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  }

  function close() {
    stop();
    onCancel();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo of your receipt"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Hidden until there are frames to show, not merely covered.
            An empty <video> is not blank: the Android webview paints its own
            placeholder into it — a grey field with a giant black play triangle
            — and that was showing full-screen behind the loading text with the
            spinner sitting on top of it. Nothing about that reads as a camera
            about to open. visibility:hidden keeps the element laid out and
            keeps the stream attached, and paints none of it. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: error ? 'none' : 'block',
            visibility: ready ? 'visible' : 'hidden',
            opacity: ready ? 1 : 0,
            transition: 'opacity .32s ease',
          }}
        />

        {/* The viewfinder. Four corner brackets in the shape of a receipt —
            tall and narrow — so there is something to aim with, and so the
            wait has the same furniture as the camera it becomes. It stays
            once the picture arrives; that is the point of it. */}
        {!error && (
          <div className="cam-frame" aria-hidden="true">
            <span className="cam-corner tl" />
            <span className="cam-corner tr" />
            <span className="cam-corner bl" />
            <span className="cam-corner br" />
            <span className={ready ? 'cam-scan is-idle' : 'cam-scan'} />
          </div>
        )}

        {!ready && !error && (
          <div className="cam-loading">
            <span className="cam-lens" aria-hidden="true">
              <Icon name="camera" size={26} />
            </span>
            <span className="cam-loading-text">Opening the camera</span>
            <span className="cam-loading-hint">Hold the receipt flat and fill the frame</span>
          </div>
        )}

        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              padding: 28,
              textAlign: 'center',
              color: '#fff',
            }}
          >
            <Icon name="camera" size={34} />
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, maxWidth: 320, color: 'rgba(255,255,255,.82)' }}>
              {error}
            </p>
            <button type="button" className="btn btn-primary" onClick={onChooseFile}>
              Choose a file instead
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={close}
          aria-label="Close the camera"
          style={{
            position: 'absolute',
            top: 'calc(14px + env(safe-area-inset-top))',
            right: 14,
            width: 42,
            height: 42,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,.22)',
            background: 'rgba(0,0,0,.45)',
            color: '#fff',
            fontSize: 22,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          &times;
        </button>
      </div>

      {!error && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 26,
            padding: '20px 20px calc(24px + env(safe-area-inset-bottom))',
            // Not a hard black seam against the picture. The bar lifts out of
            // the frame rather than being stuck on under it.
            background: 'linear-gradient(to bottom, rgba(0,0,0,.55), #000 34%)',
          }}
        >
          <button type="button" onClick={onChooseFile} className="cam-alt">
            <Icon name="file" size={15} />
            Choose a file
          </button>

          {/* The shutter, drawn the way every camera draws one, so there is
              nothing to read before using it. A ring with a disc inside, and
              the disc alone shrinks on the press — the ring holding still is
              what makes it feel like a shutter rather than a button. */}
          <button
            type="button"
            onClick={shoot}
            disabled={!ready || busy}
            aria-label="Take the photo"
            className={`cam-shutter${busy ? ' is-busy' : ''}${ready ? ' is-ready' : ''}`}
          >
            <span className="cam-shutter-disc" />
          </button>

          <span style={{ width: 96 }} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
