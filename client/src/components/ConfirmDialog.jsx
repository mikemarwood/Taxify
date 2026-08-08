import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from './Icon.jsx';

// The one confirmation dialog.
//
// window.confirm was doing this everywhere, and it is the wrong tool for
// anything that matters: it cannot be styled, it cannot explain itself in more
// than a wall of plain text, it looks like a browser warning rather than
// something this app meant to say, and on a phone it is a system sheet with no
// relationship to the page underneath.
//
// `requireText` is for the irreversible ones. Typing the thing back is not
// ceremony — it is the only check that the row being acted on is the row that
// was meant, which a mis-click cannot pass.
export default function ConfirmDialog({
  open,
  title,
  body,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  requireText = null,
  // Off by default. A press outside the box is usually a mis-click, and this
  // dialog is the last thing between somebody and an action they asked to be
  // sure about — treating that mis-click as Cancel throws away what they were
  // part-way through. Escape is unaffected: pressing it is a decision, and
  // there has to be a way out from the keyboard.
  dismissOnBackdrop = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');

  // Cleared whenever it opens, so a previous attempt cannot pre-satisfy the
  // check on the next one.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  // Escape always cancels, whatever the backdrop does. The two were tied
  // together, so turning off click-outside also took away the only way to
  // leave the dialog from a keyboard.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const matched = !requireText || typed.trim().toLowerCase() === String(requireText).trim().toLowerCase();
  const danger = tone === 'danger';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => dismissOnBackdrop && !busy && onCancel()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(8, 14, 24, 0.58)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 1500,
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="card"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', gap: 12 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: danger ? 'rgba(239, 68, 68, 0.14)' : 'var(--accent-soft)',
                  color: danger ? 'var(--red)' : 'var(--accent)',
                }}
              >
                <Icon name={danger ? 'alert' : 'info'} size={17} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: '0 0 5px', fontSize: 17 }}>{title}</h2>
                {body && (
                  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{body}</p>
                )}
              </div>
            </div>

            {detail && (
              <div
                style={{
                  padding: '11px 13px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border)',
                  fontSize: 12.5,
                  color: 'var(--text-muted)',
                  lineHeight: 1.55,
                }}
              >
                {detail}
              </div>
            )}

            {requireText && (
              <div>
                <label className="label" htmlFor="confirm-typed">
                  Type <strong style={{ color: 'var(--text)' }}>{requireText}</strong> to confirm
                </label>
                <input
                  id="confirm-typed"
                  className="input"
                  value={typed}
                  autoComplete="off"
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy} style={{ fontSize: 13 }}>
                {cancelLabel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onConfirm}
                disabled={busy || !matched}
                style={{ fontSize: 13, background: danger ? 'var(--red)' : undefined, borderColor: danger ? 'var(--red)' : undefined }}
              >
                {busy && <span className="spinner" />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
