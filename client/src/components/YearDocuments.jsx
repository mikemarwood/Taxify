import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|jfif)$/i;

// Small enough to sit in a list row, big enough that a page of a statement is
// recognisable — which "PDF" written in a box never is.
function Thumb({ doc }) {
  const frame = {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 7,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
  };

  if (IMAGE_EXT.test(doc.originalName)) {
    return (
      <span style={frame}>
        <img src={doc.url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
      </span>
    );
  }

  if (/\.pdf$/i.test(doc.originalName)) {
    return (
      <span style={frame}>
        <iframe
          src={`${doc.url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
          title=""
          tabIndex={-1}
          loading="lazy"
          style={{
            width: 160,
            height: 160,
            border: 'none',
            transform: 'scale(0.25)',
            transformOrigin: 'top left',
            pointerEvents: 'none',
            background: '#fff',
          }}
        />
      </span>
    );
  }

  return (
    <span style={frame}>
      <Icon name="file-text" size={18} />
    </span>
  );
}

// The paperwork filed against a financial year, shown where the year is —
// on a report or beside that year's expenses. Which category it came from is a
// label here, not the way in: at tax time you want the year's documents
// together, whatever they were attached to.
export default function YearDocuments({ financialYear, title = 'Documents for this year', collapsible = true }) {
  const [documents, setDocuments] = useState(null);
  const [open, setOpen] = useState(!collapsible);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!financialYear || financialYear === 'all') {
      setDocuments([]);
      return;
    }
    setDocuments(null);
    let cancelled = false;
    api
      .get(`/categories/documents/year/${encodeURIComponent(financialYear)}`)
      .then((res) => !cancelled && setDocuments(res.data.documents))
      .catch(() => !cancelled && setDocuments([]));
    return () => {
      cancelled = true;
    };
  }, [financialYear]);

  // Nothing filed for this year is not worth a panel saying so.
  if (!financialYear || financialYear === 'all' || (documents && documents.length === 0)) return null;

  const count = documents?.length ?? 0;
  const totalBytes = (documents || []).reduce((sum, d) => sum + (d.sizeBytes || 0), 0);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 18px',
          background: 'none',
          border: 0,
          cursor: collapsible ? 'pointer' : 'default',
          textAlign: 'left',
          font: 'inherit',
          color: 'var(--text)',
        }}
      >
        <Icon name="folder" size={18} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {documents === null
            ? 'loading…'
            : `FY ${financialYear} · ${count} file${count === 1 ? '' : 's'}${
                totalBytes ? ` · ${formatSize(totalBytes)}` : ''
              }`}
        </span>
        {collapsible && (
          <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ marginLeft: 'auto', display: 'flex', color: 'var(--text-muted)' }}>
            <Icon name="chevron-down" size={16} />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && documents !== null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {documents.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '8px 11px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                  }}
                >
                  <Thumb doc={d} />
                  <button
                    type="button"
                    title={`${d.originalName} — click to preview`}
                    onClick={() => setPreview({ url: d.url, filename: d.originalName })}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      font: 'inherit',
                      color: 'var(--text)',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontWeight: 600,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.documentName}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11.5,
                        color: d.category.color,
                        marginTop: 2,
                      }}
                    >
                      <Icon name={d.category.icon} size={12} />
                      {d.category.name}
                    </span>
                  </button>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{formatSize(d.sizeBytes)}</span>
                  <a
                    href={`${d.url}${d.url.includes('?') ? '&' : '?'}download=1`}
                    download
                    title="Download"
                    style={{ display: 'flex', color: 'var(--text-muted)' }}
                  >
                    <Icon name="download" size={16} />
                  </a>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {preview && <ReceiptLightbox url={preview.url} filename={preview.filename} onClose={() => setPreview(null)} />}
    </div>
  );
}
