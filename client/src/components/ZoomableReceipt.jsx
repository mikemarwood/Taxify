import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.0015; // per unit of wheel delta

// PDFs need an <iframe> — an <img> can't render them, and browsers display a
// same-origin PDF inline with their own viewer (which brings its own zoom).
// Images stay in an <img> so they scale cleanly. HEIC falls through to the
// img error path, since Chrome and Firefox can't decode it either way.
function isPdf(filename, url) {
  if (filename) return /\.pdf$/i.test(filename);
  return /\.pdf(\?|$)/i.test(url || '');
}

// The zoom/pan surface shared by the lightbox and the inbox's inline viewer,
// so scrolling to read a docket behaves identically wherever you opened it.
export default function ZoomableReceipt({ url, filename, style, showHint = true }) {
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

  // A different file in the same viewer starts fresh rather than inheriting
  // the last one's zoom.
  useEffect(reset, [url, reset]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === '0') reset();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reset]);

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

  if (pdf) {
    return (
      <iframe
        src={url}
        title={filename || 'Receipt'}
        style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: '#fff', ...style }}
      />
    );
  }

  if (imgError) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          ...style,
        }}
      >
        <Icon name="file-text" size={32} />
        <p style={{ margin: 0, fontSize: 13 }}>This file can’t be shown in the browser.</p>
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 13 }}>
          Open it directly
        </a>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 0, ...style }}>
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => (zoom === MIN_ZOOM ? setZoom(2.5) : reset())}
        style={{
          height: '100%',
          overflow: 'hidden',
          borderRadius: 8,
          background: 'var(--bg-inset)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: zoom === MIN_ZOOM ? 'zoom-in' : 'grab',
          touchAction: 'none',
        }}
      >
        <img
          src={url}
          alt={filename || 'Receipt'}
          draggable={false}
          onError={() => setImgError(true)}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'block',
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragRef.current ? 'none' : 'transform 0.08s ease-out',
            userSelect: 'none',
          }}
        />
      </div>

      {showHint && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 9px',
            borderRadius: 999,
            background: 'rgba(16, 35, 61, 0.75)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: zoom > MIN_ZOOM ? 'auto' : 'none',
          }}
        >
          {zoom > MIN_ZOOM ? (
            <button
              type="button"
              onClick={reset}
              style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
            >
              {Math.round(zoom * 100)}% · reset
            </button>
          ) : (
            <>
              <Icon name="zoom-in" size={11} />
              Scroll to zoom
            </>
          )}
        </div>
      )}
    </div>
  );
}
