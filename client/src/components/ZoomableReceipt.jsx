import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.0015; // per unit of wheel delta

// PDFs need an <iframe> — an <img> can't render them, and browsers display a
// same-origin PDF inline with their own viewer (which brings its own zoom).
// Images stay in an <img> so they scale cleanly. HEIC is converted to JPEG by
// the server before it gets here, so it renders like any other image.
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

  // Pinch, which is the only way to zoom on a phone.
  //
  // There was none, and touchAction is 'none' so the browser's own pinch was
  // switched off as well — between the two, a receipt on a phone could not be
  // enlarged at all. A wheel is not available on a touchscreen and was the
  // only thing wired up.
  //
  // Both fingers are tracked here rather than through the drag path, because
  // the second finger landing has to stop the pan cleanly: without that, the
  // image lurches as the midpoint jumps between the two.
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  function midpointIn(node) {
    const points = [...pointersRef.current.values()];
    const rect = node.getBoundingClientRect();
    const x = (points[0].x + points[1].x) / 2;
    const y = (points[0].y + points[1].y) / 2;
    return {
      cx: x - (rect.left + rect.width / 2),
      cy: y - (rect.top + rect.height / 2),
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
    };
  }

  function onPointerDown(e) {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 2) {
      dragRef.current = null; // a pinch is starting; stop panning
      const { distance, cx, cy } = midpointIn(e.currentTarget);
      pinchRef.current = { distance, cx, cy, zoom, offset };
      return;
    }
    if (zoom === MIN_ZOOM) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset };
  }

  function onPointerMove(e) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const { distance } = midpointIn(e.currentTarget);
      if (!distance || !pinch.distance) return;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.zoom * (distance / pinch.distance)));
      // The point between the fingers stays between the fingers — the same
      // correction the wheel makes around the cursor.
      const ratio = next / pinch.zoom;
      setZoom(next);
      setOffset(
        next === MIN_ZOOM
          ? { x: 0, y: 0 }
          : { x: pinch.cx - (pinch.cx - pinch.offset.x) * ratio, y: pinch.cy - (pinch.cy - pinch.offset.y) * ratio }
      );
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.origin.x + (e.clientX - drag.startX),
      y: drag.origin.y + (e.clientY - drag.startY),
    });
  }

  function endDrag(e) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
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

  // Word documents can be attached, but nothing in a browser renders one — say
  // so up front rather than letting an <img> fail and calling it an error.
  const office = /\.docx?$/i.test(filename || '');
  if (office || imgError) {
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
        <p style={{ margin: 0, fontSize: 13 }}>
          {office ? 'Word documents open outside the browser.' : 'This file can’t be shown in the browser.'}
        </p>
        <a href={`${url}?download=1`} download className="btn btn-ghost" style={{ fontSize: 13 }}>
          {office ? 'Download to open' : 'Open it directly'}
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
