import { useState } from 'react';
import Icon from './Icon.jsx';

function isPdf(filename, url) {
  if (filename) return /\.pdf$/i.test(filename);
  return /\.pdf(\?|$)/i.test(url || '');
}


// An inline thumbnail of the actual receipt rather than a "view receipt"
// button — you can see what's attached without opening anything. PDFs render
// their first page in an iframe, which browsers do natively for a same-origin
// file; pointer events are disabled on it so the click reaches the wrapper and
// opens the zoomable lightbox instead of the browser's own PDF controls.
// height is a ceiling rather than a fixed size. At a flat 260px the preview
// alone was a third of a laptop's modal, which is what pushed almost every
// expense past the point of scrolling. It gives that back on a short screen
// and keeps the full size on a tall one.
export default function ReceiptPreview({ url, filename, onOpen, height = 'min(260px, 30vh)' }) {
  const [imgError, setImgError] = useState(false);
  const pdf = isPdf(filename, url);
  // HEIC no longer lands here — the server converts it to JPEG for display —
  // so this is a Word document, or a file that genuinely failed to load.
  const office = /\.docx?$/i.test(filename || '');
  const unrenderable = office || (!pdf && imgError);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${filename || 'Receipt'} — click to enlarge, then scroll to zoom`}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        height,
        padding: 0,
        overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        cursor: 'zoom-in',
      }}
    >
      {unrenderable ? (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--text-muted)',
          }}
        >
          <Icon name="file-text" size={30} />
          <span style={{ fontSize: 12 }}>{office ? 'Word document — open to view' : 'Preview unavailable'}</span>
        </div>
      ) : pdf ? (
        <iframe
          src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
          title={filename || 'Receipt'}
          tabIndex={-1}
          style={{ width: '100%', height: '100%', border: 'none', background: '#fff', pointerEvents: 'none' }}
        />
      ) : (
        /* `contain`, not `cover`. Cropping a receipt to fill the box cuts off
           the total — the one line anybody wants without opening it. */
        <img
          src={url}
          alt={filename || 'Receipt'}
          // Decoded off the main thread, so a large photo does not hold up the
          // rest of the panel while the browser works through it.
          decoding="async"
          loading="lazy"
          onError={() => setImgError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center',
            display: 'block',
          }}
        />
      )}

      <span
        style={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 9px',
          borderRadius: 999,
          background: 'rgba(5, 6, 10, 0.72)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.2,
          pointerEvents: 'none',
        }}
      >
        <Icon name="zoom-in" size={12} />
        Click to enlarge
      </span>
    </button>
  );
}
