import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import { playSuccess, playError } from '../lib/sounds.js';
import { OFF_SCREEN_INPUT } from '../lib/fileInput.js';
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

  const preview = file ? URL.createObjectURL(file) : null;
  const isImage = file && file.type.startsWith('image/');
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
      onClick={() => !busy && inputRef.current?.click()}
      style={{
        border: `2px dashed ${status === 'error' ? 'var(--red)' : dragOver ? 'var(--violet)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 18,
        textAlign: 'center',
        cursor: busy ? 'default' : 'pointer',
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
                <p style={{ marginTop: 6, fontWeight: 600 }}>Add a receipt</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Images, PDF or Word, up to 10MB
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '8px 16px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      cameraInputRef.current?.click();
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
                      inputRef.current?.click();
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
    </div>
  );
}
