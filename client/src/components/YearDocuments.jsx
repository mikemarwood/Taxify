import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
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
export default function YearDocuments({
  financialYear,
  title = 'Documents for this year',
  collapsible = true,
  // Reports is where these are kept, so that is the only place that offers to
  // add or remove one. Everywhere else lists them and nothing more.
  manage = false,
}) {
  const toast = useToast();
  const [documents, setDocuments] = useState(null);
  const [open, setOpen] = useState(!collapsible);
  const [preview, setPreview] = useState(null);

  // Which property a new document belongs to. Rental categories only, because
  // that is what the upload route accepts, and they are per financial year.
  const [properties, setProperties] = useState([]);
  const [adding, setAdding] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const usable = financialYear && financialYear !== 'all';

  function load() {
    if (!usable) {
      setDocuments([]);
      return undefined;
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
  }

  useEffect(load, [financialYear]);

  useEffect(() => {
    if (!manage || !usable) return undefined;
    let cancelled = false;
    api
      .get(`/categories?financialYear=${encodeURIComponent(financialYear)}`)
      .then((res) => {
        if (cancelled) return;
        const rentals = (res.data.categories || []).filter((c) => c.isPropertyRental);
        setProperties(rentals);
        setPropertyId((current) =>
          rentals.some((c) => String(c.id) === String(current)) ? current : String(rentals[0]?.id || '')
        );
      })
      .catch(() => !cancelled && setProperties([]));
    return () => {
      cancelled = true;
    };
  }, [manage, financialYear, usable]);

  async function upload(e) {
    e.preventDefault();
    if (files.length === 0 || !propertyId) return;
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) form.append('documents', file);
      form.append('financialYear', financialYear);
      if (documentName.trim()) form.append('documentName', documentName.trim());
      await api.post(`/categories/${propertyId}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast(`${files.length} document${files.length === 1 ? '' : 's'} filed`, 'success');
      setFiles([]);
      setDocumentName('');
      setAdding(false);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc) {
    if (!window.confirm(`Delete "${doc.documentName}"? The file is removed for good.`)) return;
    try {
      await api.delete(
        `/categories/${doc.category.id}/documents/${encodeURIComponent(doc.filename)}?year=${encodeURIComponent(
          doc.financialYear || financialYear
        )}`
      );
      toast('Document deleted', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // A year with nothing filed is not worth a panel — unless this is the place
  // documents are added, where an empty panel is the only way to add the first
  // one. With no rental property there is nothing to attach a document to
  // either, so there is still nothing to show.
  if (!usable) return null;
  if (documents && documents.length === 0 && !(manage && properties.length > 0)) return null;

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
            : count === 0
            ? `FY ${financialYear} · nothing filed yet`
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
                  {manage && (
                    <button
                      type="button"
                      title="Delete this document"
                      onClick={() => remove(d)}
                      style={{
                        display: 'flex',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: 6,
                        margin: -6,
                      }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
              ))}

              {manage && properties.length > 0 && (
                <div style={{ marginTop: documents.length > 0 ? 6 : 0 }}>
                  {!adding ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12.5, gap: 7 }}
                      onClick={() => setAdding(true)}
                    >
                      <Icon name="upload" size={14} />
                      Add a document
                    </button>
                  ) : (
                    <form
                      onSubmit={upload}
                      style={{
                        display: 'grid',
                        gap: 10,
                        padding: 13,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-inset)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div>
                        <label className="label">Which property</label>
                        <select
                          className="input"
                          value={propertyId}
                          onChange={(e) => setPropertyId(e.target.value)}
                        >
                          {properties.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="label">Name it (optional)</label>
                        <input
                          className="input"
                          value={documentName}
                          maxLength={200}
                          placeholder="e.g. Council rates notice"
                          onChange={(e) => setDocumentName(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="label">File</label>
                        <input
                          className="input"
                          type="file"
                          multiple
                          onChange={(e) => setFiles([...e.target.files])}
                        />
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
                          Filed under FY {financialYear}. Several at once share the name you give them.
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 9 }}>
                        <button className="btn btn-primary" style={{ fontSize: 12.5 }} disabled={busy || files.length === 0}>
                          {busy && <span className="spinner" />}
                          {busy
                            ? 'Filing…'
                            : files.length === 0
                            ? 'Choose a file'
                            : `File ${files.length} document${files.length === 1 ? '' : 's'}`}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 12.5 }}
                          onClick={() => {
                            setAdding(false);
                            setFiles([]);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {preview && <ReceiptLightbox url={preview.url} filename={preview.filename} onClose={() => setPreview(null)} />}
    </div>
  );
}
