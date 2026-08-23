import { useEffect } from 'react';
import { useLockBodyScroll } from '../lib/useLockBodyScroll.js';
import { motion, AnimatePresence } from 'framer-motion';
import ZoomableReceipt from './ZoomableReceipt.jsx';
import Icon from './Icon.jsx';

// Full-screen receipt viewer. The zoom, pan and PDF handling all live in
// ZoomableReceipt, so this is only the frame around it: the backdrop, the
// close affordance, and the download link.
export default function ReceiptLightbox({ url, filename, onClose }) {
  // The page behind must not move while this is over it.
  useLockBodyScroll(open);
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(16, 24, 40, 0.55)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1300,
        }}
        className="receipt-backdrop"
        // Clicking outside deliberately does nothing.
        //
        // A receipt is looked at, dragged and zoomed, and any of those can
        // end with the pointer past the edge of the image — closing on that
        // throws away what somebody was in the middle of reading. The cross
        // and Escape and the Close button are three deliberate ways out,
        // which is enough; a fourth that fires by accident is not a way out
        // at all.
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          // Sized in theme.css rather than here, so a phone can be given the
          // whole window. An inline width cannot be overridden by a media
          // query without !important, and a receipt in a 90vw card with 20px
          // of backdrop around it is a small picture of a small picture.
          className="card receipt-viewer"
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <button
            type="button"
            aria-label="Close preview"
            title="Close (Esc)"
            // It had no onClick at all — a cross in the corner of a
            // dialog that did nothing when pressed. Escape worked, and so
            // did the Close button at the foot, so the one thing everybody
            // reaches for first was the one thing that was dead.
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text)',
              cursor: 'pointer',
              zIndex: 1,
            }}
          >
            <Icon name="x" size={15} />
          </button>

          <div style={{ flex: 1, minHeight: 0 }}>
            <ZoomableReceipt url={url} filename={filename} />
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filename}
            </span>
            <a href={`${url}?download=1`} download className="btn btn-primary" style={{ fontSize: 13 }}>
              <Icon name="download" size={15} />
              Download
            </a>
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
