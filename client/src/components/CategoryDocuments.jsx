import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';
import { playSuccess, playError } from '../lib/sounds.js';

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

// The paperwork that belongs to a rental property rather than to any single
// expense — agent statements, depreciation schedules, the end-of-year summary.
// Several arrive at once, so this takes a whole selection in one go.
export default function CategoryDocuments({ category }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [documents, setDocuments] = useState(null);
  const [directory, setDirectory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    api
      .get(`/categories/${category.id}/documents`)
      .then((res) => {
        setDocuments(res.data.documents);
        setDirectory(res.data.directory || '');
      })
      .catch(() => setDocuments([]));
  }, [category.id]);

  useEffect(load, [load]);

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
      toast(`${res.data.uploaded} document${res.data.uploaded === 1 ? '' : 's'} uploaded`, 'success');
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
    if (!window.confirm(`Delete “${doc.originalName}”? This removes the file from disk.`)) return;
    try {
      await api.delete(`/categories/${category.id}/documents/${encodeURIComponent(doc.filename)}`);
      setDocuments((prev) => prev.filter((d) => d.filename !== doc.filename));
      toast('Document deleted', 'success');
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
          {documents === null ? 'loading…' : `${documents.length} file${documents.length === 1 ? '' : 's'}`}
        </span>
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

      {documents !== null && documents.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {documents.map((d) => (
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
              <Icon name={iconForName(d.originalName)} size={14} style={{ color: 'var(--text-muted)' }} />
              <button
                type="button"
                title="Preview"
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
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.originalName}
              </button>
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{formatSize(d.sizeBytes)}</span>
              <a
                href={`${d.url}?download=1`}
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
      )}

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
