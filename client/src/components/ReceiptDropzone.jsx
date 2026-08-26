import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import { playSuccess, playError } from '../lib/sounds.js';
import { OFF_SCREEN_INPUT } from '../lib/fileInput.js';
import CameraCapture, { inAppCameraUnavailable } from './CameraCapture.jsx';
// Shared with the year-documents form and mirrored from the server's copy.
// This file used to carry its own list, and it accepted SVG — `.svg` was in
// the extension pattern and `image/svg+xml` passed the "starts with image/"
// branch besides. The server has always refused it, so the only thing the
// difference bought was somebody waiting for an upload that was going to be
// rejected.
import { BROWSE_ACCEPT, uploadProblem } from '../lib/uploadRules.js';

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ReceiptDropzone({ file, onFileChange, uploadProgress, status = 'idle', errorMessage }) {
  const [dragOver, setDragOver] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const toast = useToast();
  const busy = status === 'uploading';
  const isMobile = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
    []
  );

  // The parent owns the upload, so the outcome is only visible here as a
  // status change — which is the moment to make a sound.
  useEffect(() => {
    if (status === 'success') playSuccess();
    else if (status === 'error') playError();
  }, [status]);

  const handleFiles = useCallback(
    (files) => {
      const picked = files && files[0];
      if (!picked) return;
      const problem = uploadProblem(picked);
      if (problem) {
        toast(problem, 'error');
        return;
      }
      onFileChange(picked);
    },
    [onFileChange, toast]
  );

  // Cleared after every pick, so choosing the same file again still counts as
  // a change. Remove a receipt, decide you wanted it after all, pick the same
  // one — without this the input's value never changed, onChange never fired,
  // and the second attempt looked like a dead button.
  const onPicked = useCallback(
    (e) => {
      handleFiles(e.target.files);
      e.target.value = '';
    },
    [handleFiles]
  );

  // Photographing goes through CameraCapture, which is the only way to be sure
  // which lens opens — see the note at the top of that file. The old
  // capture="environment" input is still here and is what we fall back to when
  // getUserMedia is unavailable or refused.
  const openCamera = useCallback(() => {
    if (busy) return;
    // Straight to the phone's camera app once the in-app one has failed here
    // — it fails for a whole install at a time, and opening an overlay that
    // is going to close itself again looks like a fault rather than a
    // fallback. See CameraCapture.jsx.
    if (inAppCameraUnavailable()) {
      cameraInputRef.current?.click();
      return;
    }
    setCameraOpen(true);
  }, [busy]);

  const openBrowse = useCallback(() => {
    if (busy) return;
    inputRef.current?.click();
  }, [busy]);

  // Only reached when the in-app camera cannot run at all. Hands over to the
  // native capture input, which is second choice rather than first because it
  // is the path whose lens we do not control — but a camera app with the wrong
  // lens beats no camera.
  const cameraFallback = useCallback(
    (message) => {
      setCameraOpen(false);
      if (message) toast(message, 'error');
      // After the overlay has gone: a click on an input underneath a covering
      // element does not open a picker.
      setTimeout(() => cameraInputRef.current?.click(), 0);
    },
    [toast]
  );

  // Somebody in the camera saying they would rather pick a file. A different
  // thing from the camera having failed, and it goes somewhere different.
  const chooseFileInstead = useCallback(() => {
    setCameraOpen(false);
    setTimeout(() => inputRef.current?.click(), 0);
  }, []);

  // Made once per file and handed back afterwards.
  //
  // This was URL.createObjectURL(file) inline in the render body, which mints
  // a fresh blob URL on every single render and never releases one. Each holds
  // the whole file in memory until the tab closes, and a receipt photographed
  // on a phone is several megabytes — so typing into the amount box, which
  // re-renders this component on every keystroke, quietly leaked one copy per
  // character.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const isImage = file && file.type.startsWith('image/');
  // A PDF previews too. The browser renders one natively from a blob URL, the
  // same way the saved-receipt preview does for a file already on the server —
  // and a receipt that arrived as a PDF is a receipt, so showing a grey page
  // icon for it while photographs get a picture was arbitrary. Checked on the
  // type and the extension both, because a file dragged in from some Windows
  // shares arrives with an empty type.
  const isPdf = file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
  const offset = CIRCUMFERENCE - (uploadProgress / 100) * CIRCUMFERENCE;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!busy) handleFiles(e.dataTransfer.files);
      }}
      // Clickable at a desk, inert on a phone.
      //
      // On a desktop the box is a dropzone and says so — "Drop a receipt here,
      // or click to browse" — so the whole of it being a target is what the
      // words promise. It also gets role and a key handler, because a div with
      // an onClick alone is invisible to a keyboard and announced as nothing.
      //
      // On a phone it does nothing, deliberately. The card there already holds
      // two explicit buttons, and a thumb resting anywhere on a large target
      // that silently opens a camera is a surprise rather than a shortcut. The
      // buttons say which one you are getting; the card should not guess.
      {...(isMobile
        ? {}
        : {
            role: 'button',
            tabIndex: busy ? -1 : 0,
            'aria-label': 'Choose a receipt to attach',
            onClick: () => !busy && openBrowse(),
            onKeyDown: (e) => {
              if (busy) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openBrowse();
              }
            },
          })}
      style={{
        border: `2px dashed ${status === 'error' ? 'var(--red)' : dragOver ? 'var(--violet)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 18,
        textAlign: 'center',
        // No pointer cursor where the box does nothing.
        cursor: busy || isMobile ? 'default' : 'pointer',
        background: status === 'error' ? 'rgba(239, 68, 68, 0.06)' : dragOver ? 'var(--accent-soft)' : 'var(--bg-elevated)',
        transition: 'border-color 0.2s ease, background 0.2s ease',
        position: 'relative',
      }}
    >
      {/* Off-screen rather than hidden — see fileInput.js for why.

          onClick stops the input's *own* click from going any further, and
          that is the reason Take photo opened the file browser instead of the
          camera. Both inputs sit inside a box whose job is to open the browser
          when it is clicked, and .click() dispatches a real event that bubbles
          like any other. So the button called click() on the camera input,
          that click rose to this box, the box called click() on the browse
          input, and the browse input is what came up. Two pickers were asked
          for and the wrong one answered — in every browser, not just Safari. */}
      <input
        ref={inputRef}
        type="file"
        accept={BROWSE_ACCEPT}
        style={OFF_SCREEN_INPUT}
        tabIndex={-1}
        aria-hidden="true"
        onClick={(e) => e.stopPropagation()}
        onChange={onPicked}
      />
      {/* Still here, and still the fallback when the in-app camera cannot run.
          It is second choice rather than first because this is the path whose
          lens we do not control — the one that opens the front camera on some
          phones — but a camera app with the wrong lens beats no camera. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={OFF_SCREEN_INPUT}
        tabIndex={-1}
        aria-hidden="true"
        onClick={(e) => e.stopPropagation()}
        onChange={onPicked}
      />

      <AnimatePresence mode="wait">
        {status === 'uploading' ? (
          <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <svg width="64" height="64" viewBox="0 0 64 64" style={{ margin: '0 auto', display: 'block' }}>
              <circle className="progress-ring-track" cx="32" cy="32" r={RADIUS} strokeWidth="5" />
              <circle
                className="progress-ring-bar"
                cx="32"
                cy="32"
                r={RADIUS}
                strokeWidth="5"
                stroke="url(#grad)"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={offset}
                transform="rotate(-90 32 32)"
              />
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1a66cf" />
                  <stop offset="100%" stopColor="#0b6d84" />
                </linearGradient>
              </defs>
              <text x="32" y="37" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">
                {uploadProgress}%
              </text>
            </svg>
            <p style={{ margin: '12px 0 10px', color: 'var(--text-muted)', fontSize: 13 }}>Uploading receipt…</p>
            <div style={{ maxWidth: 260, margin: '0 auto' }}>
              <ProgressBar value={uploadProgress} />
            </div>
          </motion.div>
        ) : status === 'success' ? (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--emerald)' }}>
              <Icon name="check-circle" size={38} />
            </div>
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>Receipt uploaded</p>
          </motion.div>
        ) : status === 'error' ? (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--red)' }}>
              <Icon name="alert" size={38} />
            </div>
            <p style={{ marginTop: 10, fontWeight: 600, color: 'var(--red)' }}>Upload failed</p>
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{errorMessage || 'Something went wrong — try again.'}</p>
          </motion.div>
        ) : file ? (
          <motion.div key="preview" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            {isImage ? (
              <img src={preview} alt="Receipt preview" style={{ maxHeight: 140, borderRadius: 10, margin: '0 auto', display: 'block' }} />
            ) : isPdf ? (
              /* pointer-events off, so a click still reaches the card behind
                 rather than being swallowed by the PDF viewer's own controls.
                 The same reason ReceiptPreview does it for saved files. */
              <iframe
                src={`${preview}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                title={file.name || 'Receipt preview'}
                tabIndex={-1}
                style={{
                  width: '100%',
                  maxWidth: 220,
                  height: 140,
                  margin: '0 auto',
                  display: 'block',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: '#fff',
                  pointerEvents: 'none',
                }}
              />
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <Icon name="file-text" size={38} />
              </div>
            )}
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>{file.name}</p>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 10, padding: '6px 14px', fontSize: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
              }}
            >
              Remove
            </button>
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* The icon sits beside the words rather than above them.

                It was a 30px glyph centred over two centred paragraphs inside
                28px of padding — a tall, formal block for a field most people
                skip, and the tallest thing on a form whose actual subject is
                the amount. On one line it says the same and takes a third of
                the room. */}
            {isMobile ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  <Icon name="receipt" size={26} />
                </div>
                {/* Not "tap to add" — on a phone the card is deliberately not
                    a target, and a heading that invites a tap would be lying
                    about the two buttons underneath it. */}
                <p style={{ marginTop: 6, fontWeight: 600 }}>Add a receipt</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Images, PDF or Word, up to 10MB
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  {/* Both still here, because the box now does the same thing
                      as the first of them and somebody who wants the other one
                      should not have to guess that it exists. */}
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '8px 16px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openCamera();
                    }}
                  >
                    <Icon name="camera" size={15} />
                    Take photo
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '8px 16px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openBrowse();
                    }}
                  >
                    <Icon name="folder" size={15} />
                    Choose file
                  </button>
                </div>
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  textAlign: 'left',
                }}
              >
                <Icon name="receipt" size={22} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>Drop a receipt here, or click to browse</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Images, PDF or Word, up to 10MB
                  </span>
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {cameraOpen && (
        <CameraCapture
          onCapture={(photo) => {
            setCameraOpen(false);
            handleFiles([photo]);
          }}
          onCancel={() => setCameraOpen(false)}
          onFallback={cameraFallback}
          onChooseFile={chooseFileInstead}
        />
      )}
    </div>
  );
}
