import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { OFF_SCREEN_INPUT } from '../lib/fileInput.js';
import { sentenceCase, sentenceCaseLive } from '../lib/textCase.js';
import { onCasedInput } from '../lib/casedInput.js';
import {
  BROWSE_ACCEPT,
  MAX_UPLOAD_LABEL,
  fileKind,
  uploadProblem,
} from '../lib/uploadRules.js';

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|jfif)$/i;

// What kind of file a row holds, said in the row.
//
// The thumbnail shows the first page of a PDF or the picture itself, which is
// the best answer to "which document is this" — but not to "what will I get if
// I download it". A photograph of a rates notice and a scan of one look
// identical at 40px and open in different things. The chip is that answer, in
// the two or three characters everybody already reads as a file type.
const KIND_TONES = {
  PDF: { fg: '#b91c1c', bg: 'rgba(185, 28, 28, 0.10)' },
  DOC: { fg: '#1d4ed8', bg: 'rgba(29, 78, 216, 0.10)' },
  DOCX: { fg: '#1d4ed8', bg: 'rgba(29, 78, 216, 0.10)' },
};
const IMAGE_TONE = { fg: '#047857', bg: 'rgba(4, 120, 87, 0.10)' };
const PLAIN_TONE = { fg: 'var(--text-muted)', bg: 'var(--bg-card)' };

function kindTone(kind, name) {
  if (KIND_TONES[kind]) return KIND_TONES[kind];
  if (IMAGE_EXT.test(name || '')) return IMAGE_TONE;
  return PLAIN_TONE;
}

function KindChip({ name }) {
  const kind = fileKind(name);
  if (!kind) return null;
  const tone = kindTone(kind, name);
  return (
    <span
      title={`${kind} file`}
      style={{
        flexShrink: 0,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        lineHeight: 1,
        padding: '4px 6px',
        borderRadius: 4,
        color: tone.fg,
        background: tone.bg,
      }}
    >
      {kind}
    </span>
  );
}

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
  const confirm = useConfirm();
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

  // Checked here rather than only on the server, so somebody is told which
  // file is the problem before they wait for an upload that was going to be
  // refused. The accepted ones are kept — dropping the whole selection because
  // one of five was too big is the more annoying answer.
  function onPickFiles(e) {
    const picked = [...e.target.files];
    const ok = [];
    const refused = [];
    for (const file of picked) {
      const problem = uploadProblem(file);
      if (problem) refused.push({ file, problem });
      else ok.push(file);
    }
    setFiles(ok);
    if (refused.length === 1) {
      toast(`${refused[0].file.name} — ${refused[0].problem}`, 'error');
    } else if (refused.length > 1) {
      toast(`${refused.length} files were not accepted — ${refused[0].problem}`, 'error');
    }
    // Cleared so choosing the same file again still counts as a change.
    e.target.value = '';
  }

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
    if (!(await confirm({ tone: 'danger', title: `Delete “${doc.documentName}”?`, body: 'The file is removed for good.', confirmLabel: 'Delete' }))) return;
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
                  <KindChip name={d.originalName} />
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
                          // A document name is a sentence, not a title — "Council
                          // rates notice", not "Council Rates Notice". Live while
                          // typing so the first letter comes up as you type it,
                          // and again on blur, which trims.
                          onChange={onCasedInput(sentenceCaseLive, setDocumentName)}
                          onBlur={() => setDocumentName((v) => sentenceCase(v))}
                        />
                      </div>

                      <div>
                        <label className="label">File</label>
                        {/* The same picker the rest of the app uses.
                            A bare <input type="file"> inside .input renders as
                            the browser's own grey "Choose files" button on a
                            white field — the one control on the page that
                            looks like it belongs to a different site. The real
                            input is off-screen rather than hidden, because
                            Safari will not open a picker for .click() on a
                            display:none element. */}
                        <label
                          className="btn btn-ghost"
                          style={{ fontSize: 12.5, gap: 7, cursor: 'pointer', width: 'fit-content' }}
                        >
                          <Icon name="upload" size={14} />
                          {files.length === 0
                            ? 'Choose files'
                            : `${files.length} file${files.length === 1 ? '' : 's'} chosen`}
                          <input
                            type="file"
                            multiple
                            accept={BROWSE_ACCEPT}
                            style={OFF_SCREEN_INPUT}
                            onChange={onPickFiles}
                          />
                        </label>

                        {files.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                            {files.map((f) => (
                              <div
                                key={`${f.name}-${f.size}`}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                              >
                                <KindChip name={f.name} />
                                <span
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {f.name}
                                </span>
                                <span style={{ color: 'var(--text-muted)' }}>{formatSize(f.size)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                          Images, PDFs and Word documents, up to {MAX_UPLOAD_LABEL} each. Filed under FY{' '}
                          {financialYear}. Several at once share the name you give them.
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
