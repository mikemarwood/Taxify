import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon.jsx';

const VIEWPORT = 260;
const OUTPUT_SIZE = 480;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export default function AvatarEditorModal({ imageSrc, busy, onCancel, onSave }) {
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setReady(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [imageSrc]);

  function onImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setReady(true);
  }

  const baseScale =
    naturalSize.width && naturalSize.height ? Math.max(VIEWPORT / naturalSize.width, VIEWPORT / naturalSize.height) : 0;
  const effectiveScale = baseScale * zoom;
  const displayedW = naturalSize.width * effectiveScale;
  const displayedH = naturalSize.height * effectiveScale;
  const maxOffsetX = Math.max(0, (displayedW - VIEWPORT) / 2);
  const maxOffsetY = Math.max(0, (displayedH - VIEWPORT) / 2);

  const clamp = useCallback(
    (x, y) => ({
      x: Math.min(maxOffsetX, Math.max(-maxOffsetX, x)),
      y: Math.min(maxOffsetY, Math.max(-maxOffsetY, y)),
    }),
    [maxOffsetX, maxOffsetY]
  );

  useEffect(() => {
    setOffset((o) => clamp(o.x, o.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, naturalSize.width, naturalSize.height]);

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset };
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clamp(dragRef.current.origin.x + dx, dragRef.current.origin.y + dy));
  }
  function onPointerUp(e) {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released
    }
  }

  function handleSave() {
    if (!ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    const exportScale = OUTPUT_SIZE / VIEWPORT;
    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
    ctx.translate(offset.x * exportScale, offset.y * exportScale);
    ctx.scale(effectiveScale * exportScale, effectiveScale * exportScale);
    ctx.drawImage(imgRef.current, -naturalSize.width / 2, -naturalSize.height / 2);
    ctx.restore();
    canvas.toBlob(
      (blob) => {
        if (blob) onSave(blob);
      },
      'image/png',
      0.92
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 6, 10, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1200,
          padding: 20,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="card"
          style={{ width: '100%', maxWidth: 360, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}
        >
          <h2 style={{ margin: 0, fontSize: 18, alignSelf: 'flex-start' }}>Reposition avatar</h2>

          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              width: VIEWPORT,
              height: VIEWPORT,
              borderRadius: '50%',
              overflow: 'hidden',
              position: 'relative',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              cursor: ready ? 'grab' : 'default',
              touchAction: 'none',
            }}
          >
            {!ready && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner" />
              </div>
            )}
            <img
              ref={imgRef}
              src={imageSrc}
              alt=""
              onLoad={onImgLoad}
              draggable={false}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                userSelect: 'none',
                width: naturalSize.width,
                height: naturalSize.height,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${effectiveScale})`,
                transformOrigin: 'center',
                visibility: ready ? 'visible' : 'hidden',
              }}
            />
          </div>

          <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="zoom-in" size={16} style={{ color: 'var(--text-muted)' }} />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={!ready}
              style={{ flex: 1 }}
            />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Drag to reposition, use the slider to zoom.</p>

          <div style={{ display: 'flex', gap: 10, width: '100%' }}>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={!ready || busy} onClick={handleSave}>
              {busy && <span className="spinner" />}
              Save avatar
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
