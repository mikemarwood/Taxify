import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.0015; // per unit of wheel delta

// PDFs need an <iframe> — an <img> can't render them, and browsers display a
// same-origin PDF inline with their own viewer. Images stay in an <img> so
// they scale nicely. HEIC falls through to the img error path, since Chrome
// and Firefox can't decode it either way.
function isPdf(filename, url) {
  if (filename) return /\.pdf$/i.test(filename);
  return /\.pdf(\?|$)/i.test(url || '');
}

export default function ReceiptLightbox({ url, filename, onClose }) {
  const [imgError, setImgError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const pdf = isPdf(filename, url);
  const zoomable = !pdf && !imgError;

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === '0') reset();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, reset]);

  // Wheel zoom anchored on the pointer: the image point under the cursor has
  // to stay under the cursor, so the offset is corrected by how much that
  // point moves as the scale changes. Bound as a non-passive listener because
  // React's onWheel is passive and can't preventDefault the page scroll.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !zoomable) return;

    function onWheel(e) {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      // Cursor position relative to the viewport centre.
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);

      setZoom((prevZoom) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom * Math.exp(-e.deltaY * ZOOM_STEP)));
        if (next === prevZoom) return prevZoom;
        setOffset((prev) => {
          if (next === MIN_ZOOM) return { x: 0, y: 0 };
          const ratio = next / prevZoom;
          return { x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
        });
        return next;
      });
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomable]);

  function onPointerDown(e) {
    if (zoom === MIN_ZOOM) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.origin.x + (e.clientX - drag.startX),
      y: drag.origin.y + (e.clientY - drag.startY),
    });
  }

  function endDrag(e) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 6, 10, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1300,
          padding: 20,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="card"
          style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', padding: 16, overflow: 'auto' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Close preview"
            title="Close (Esc)"
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
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              zIndex: 1,
            }}
          >
            ×
          </button>

          {pdf ? (
            <iframe
              src={url}
              title={filename || 'Receipt'}
              style={{
                width: '85vw',
                maxWidth: 900,
                height: '75vh',
                border: 'none',
                borderRadius: 8,
                display: 'block',
                background: '#fff',
              }}
            />
          ) : imgError ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)' }}>Preview not available for this file type.</p>
              <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary">
                Open receipt
              </a>
            </div>
          ) : (
            <div
              ref={viewportRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={() => (zoom === MIN_ZOOM ? setZoom(2) : reset())}
              style={{
                maxWidth: '85vw',
                maxHeight: '75vh',
                overflow: 'hidden',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: zoom === MIN_ZOOM ? 'zoom-in' : dragRef.current ? 'grabbing' : 'grab',
                touchAction: 'none',
              }}
            >
              <img
                src={url}
                alt="Receipt"
                draggable={false}
                style={{
                  maxWidth: '85vw',
                  maxHeight: '75vh',
                  display: 'block',
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: dragRef.current ? 'none' : 'transform 0.08s ease-out',
                  userSelect: 'none',
                }}
                onError={() => setImgError(true)}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            {zoomable && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 96 }}>
                {zoom > MIN_ZOOM ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={reset}
                  >
                    {Math.round(zoom * 100)}% · reset
                  </button>
                ) : (
                  'Scroll to zoom'
                )}
              </span>
            )}
            <a href={`${url}?download=1`} download className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
              Download
            </a>
            <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
