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
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(8, 12, 20, 0.86)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              color: '#f1f5f9',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 120,
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
              className="btn btn-ghost"
              style={{ fontSize: 12.5, gap: 6, textDecoration: 'none', color: '#f1f5f9', borderColor: 'rgba(255,255,255,.25)' }}
            >
              <Icon name="download" size={14} />
              Download
            </a>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="btn btn-ghost"
              style={{ fontSize: 12.5, gap: 6, color: '#f1f5f9', borderColor: 'rgba(255,255,255,.25)' }}
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
            }}
          >
            <motion.img
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              src={src}
              alt={name}
              onClick={(e) => e.stopPropagation()}
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
