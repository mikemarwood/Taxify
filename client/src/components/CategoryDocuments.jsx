import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';
import { playSuccess, playError } from '../lib/sounds.js';
import { useFinancialYears } from '../lib/useFinancialYears.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RECEIPT_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|svg|jfif|pdf|docx?)$/i;
const DOC_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Same rules as a receipt — checked here so a folder full of mixed files gives
// a clear message rather than a server error that reads like the whole batch
// failed.
function isAllowedFile(file) {
  if (DOC_MIME.has(file.type)) return true;
  if (file.type?.startsWith('image/')) return true;
  return RECEIPT_EXT.test(file.name || '');
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForName(name) {
  if (/\.pdf$/i.test(name)) return 'file-text';
  if (/\.docx?$/i.test(name)) return 'file-text';
  return 'image';
}

// A real thumbnail rather than a file-type icon — a page of a statement is
// recognisable at 40px in a way "PDF" never is. PDFs render their first page
// the same way the full preview does; pointer events are off so the click
// reaches the row.
function DocThumb({ doc }) {
  const isImage = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|jfif)$/i.test(doc.originalName);
  const isPdf = /\.pdf$/i.test(doc.originalName);

  const frame = {
    width: 38,
    height: 38,
    flexShrink: 0,
    borderRadius: 6,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
  };

  if (isImage) {
    return (
      <span style={frame}>
        <img
          src={doc.url}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
        />
      </span>
    );
  }

  if (isPdf) {
    return (
      <span style={frame}>
        <iframe
          src={`${doc.url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
          title=""
          tabIndex={-1}
          loading="lazy"
          style={{
            width: 150,
            height: 150,
            border: 'none',
            // Scaled down so a whole page fits the tile instead of the
            // top-left corner of one.
            transform: 'scale(0.253)',
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
      <Icon name={iconForName(doc.originalName)} size={16} />
    </span>
  );
}


// The paperwork that belongs to a rental property rather than to any single
// expense — agent statements, depreciation schedules, the end-of-year summary.
// Several arrive at once, so this takes a whole selection in one go.
export default function CategoryDocuments({ category }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [years, setYears] = useState(null);
  const [directory, setDirectory] = useState('');
  // Starts empty and settles on the account's current year once the server
  // says what that is — an alias that dropped the rule was defaulting every
  // non-Australian user to the wrong year.
  const [year, setYear] = useState('');
  const [docName, setDocName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  // Years this account actually has, plus the current one so paperwork can be
  // filed before the first receipt of a new year arrives.
  const { years: yearChoices, current: currentYear } = useFinancialYears();

  useEffect(() => {
    if (!year && currentYear) setYear(currentYear);
  }, [currentYear, year]);

  const load = useCallback(() => {
    api
      .get(`/categories/${category.id}/documents`)
      .then((res) => {
        setYears(res.data.years || []);
        setDirectory(res.data.directory || '');
      })
      .catch(() => setYears([]));
  }, [category.id]);

  useEffect(load, [load]);

  const totalCount = (years || []).reduce((sum, g) => sum + g.documents.length, 0);

  async function upload(fileList) {
    const all = Array.from(fileList || []);
    if (all.length === 0) return;

    const wrongType = all.filter((f) => !isAllowedFile(f));
    const rightType = all.filter(isAllowedFile);
    if (wrongType.length > 0) {
      toast(`${wrongType.length} file(s) skipped — only images, PDFs and Word documents can be attached.`, 'error');
    }
    const tooBig = rightType.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = rightType.filter((f) => f.size <= MAX_FILE_BYTES);
    if (tooBig.length > 0) toast(`${tooBig.length} file(s) skipped — documents must be 10MB or smaller.`, 'error');
    if (ok.length === 0) return;

    const form = new FormData();
    // Both text fields go in before the files: multer parses the stream in
    // order, and the destination needs the year while the files are arriving.
    form.append('financialYear', year);
    if (docName.trim()) form.append('documentName', docName.trim());
    for (const f of ok) form.append('documents', f);

    setUploading(true);
    setUploadCount(ok.length);
    setProgress(0);
    try {
      const res = await api.post(`/categories/${category.id}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => setProgress(evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0),
      });
      playSuccess();
      toast(`${res.data.uploaded} document${res.data.uploaded === 1 ? '' : 's'} added to ${year}`, 'success');
      setDocName('');
      load();
    } catch (err) {
      playError();
      toast(err.message, 'error');
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(doc) {
    if (!window.confirm(`Delete “${doc.documentName}”? This removes the file from disk.`)) return;
    try {
      await api.delete(`/categories/${category.id}/documents/${encodeURIComponent(doc.filename)}`);
      toast('Document deleted', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="folder" size={14} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>Property documents</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {years === null ? 'loading…' : `${totalCount} file${totalCount === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* The year is chosen before the files, not after: it decides which
          folder they land in, so it can't be an afterthought. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <select
          className="input"
          aria-label="Financial year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{ width: 132, fontSize: 12.5, padding: '6px 8px' }}
        >
          {yearChoices.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          placeholder="Document name (optional) — e.g. Annual Rental Statement"
          maxLength={200}
          style={{ flex: 1, minWidth: 200, fontSize: 12.5, padding: '6px 10px' }}
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading) upload(e.dataTransfer.files);
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: 12,
          textAlign: 'center',
          cursor: uploading ? 'default' : 'pointer',
          background: dragOver ? 'var(--accent-soft)' : 'var(--bg-elevated)',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif,.pdf,.doc,.docx"
          multiple
          hidden
          onChange={(e) => upload(e.target.files)}
        />
        {uploading ? (
          <ProgressBar value={progress} label={`Uploading ${uploadCount} document${uploadCount === 1 ? '' : 's'}`} />
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Drop end-of-year statements and other paperwork here, or click to choose several.
            <div style={{ fontSize: 11.5, marginTop: 3 }}>Images, PDF or Word — up to 10MB each.</div>
          </div>
        )}
      </div>

      {years !== null &&
        years.map((group) => (
          <div key={group.year} style={{ marginTop: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 5,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              <span>{group.year === 'Unfiled' ? 'Unfiled' : `FY ${group.year}`}</span>
              <span style={{ fontWeight: 600, letterSpacing: 0 }}>
                {group.documents.length} file{group.documents.length === 1 ? '' : 's'}
              </span>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {group.documents.map((d) => (
                <div
                  key={d.filename}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    fontSize: 12.5,
                  }}
                >
                  <DocThumb doc={d} />
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
                      color: 'var(--text)',
                      font: 'inherit',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {d.documentName}
                  </button>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{formatSize(d.sizeBytes)}</span>
                  <a
                    href={`${d.url}${d.url.includes('?') ? '&' : '?'}download=1`}
                    download
                    title="Download"
                    style={{ display: 'flex', color: 'var(--text-muted)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="download" size={14} />
                  </a>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => remove(d)}
                    style={{ display: 'flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--red)' }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

      {directory && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {directory}
        </div>
      )}

      {preview && (
        <ReceiptLightbox url={preview.url} filename={preview.filename} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
