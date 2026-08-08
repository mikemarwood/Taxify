import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon.jsx';

// A full-size look at an attachment, without leaving the conversation.
//
// Opening the file in a new tab was the alternative, and it loses the thread:
// you come back to a page that has reloaded, scrolled to the top, and forgotten
// the reply you were half way through writing.
//
// Rendered through a portal because the thread sits inside scrolling, bordered
// panels — anything positioned within them is clipped by the first ancestor
// with an overflow rule, which on the admin queue is two levels up.
//
// A press outside the image does not close it. Panning a photo on a phone means
// dragging across whatever is around it, and losing the preview mid-drag is not
// a dismissal anybody asked for. Escape and the Close button are the ways out.
export default function ImageLightbox({ open, src, name, onClose }) {
  useEffect(() => {
    if (!open) return undefined;

    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);

    // The page behind must not scroll while this is over it — on a phone,
    // dragging to pan the image otherwise drags the thread instead.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            // Not inset:0 and not 100vh. Both resolve to the *large* viewport
            // on a phone — the height the page would have with the browser's
            // own bars hidden — so the overlay came out taller than the screen
            // and the whole thing scrolled. dvh is what is actually visible.
            height: '100dvh',
            zIndex: 2000,
            background: 'rgba(8, 12, 20, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            // Stops a drag at the top or bottom edge from handing the scroll
            // back to the page underneath.
            overscrollBehavior: 'contain',
            touchAction: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              color: '#f1f5f9',
              flexWrap: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                // Shrinks rather than pushing the buttons off the row —
                // the header no longer wraps, so a long filename would
                // otherwise take Close with it.
                flex: '1 1 0',
                minWidth: 0,
                fontSize: 13.5,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </span>

            {/* download, not target=_blank: the file is served with a
                Content-Disposition of its own, and this asks for the version
                that saves rather than the one that displays. */}
            <a
              href={`${src}${src.includes('?') ? '&' : '?'}download=1`}
              download={name}
              style={{
                fontSize: 12.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 13px',
                borderRadius: 8,
                cursor: 'pointer',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                color: '#0f172a',
                background: '#f1f5f9',
                border: '1px solid rgba(255,255,255,.35)',
                fontWeight: 600,
              }}
            >
              <Icon name="download" size={14} />
              Download
            </a>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              style={{
                fontSize: 12.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 13px',
                borderRadius: 8,
                cursor: 'pointer',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                color: '#0f172a',
                background: '#f1f5f9',
                border: '1px solid rgba(255,255,255,.35)',
                fontWeight: 600,
              }}
            >
              <Icon name="x" size={14} />
              Close
            </button>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 16px 20px',
              // The image is fitted, never overflowing, so there is nothing
              // here to scroll in the first place.
              overflow: 'hidden',
            }}
          >
            <motion.img
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              src={src}
              alt={name}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)',
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
