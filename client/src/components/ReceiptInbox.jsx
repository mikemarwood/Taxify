import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';
import { inboxFileUrl } from './ReceiptGallery.jsx';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function isImageFilename(name) {
  return /\.(jpe?g|png|webp|gif)$/i.test(name);
}

// HEIC/HEIF store and download fine, but Chrome and Firefox can't decode them
// in an <img>, so they show a placeholder rather than a broken image.
function placeholderFor(name) {
  return /\.(heic|heif)$/i.test(name) ? '🖼' : '📄';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Bulk staging area: drop everything in here, then attach each one from the
// expense's own edit screen. Files live in <user>/_inbox until assigned.
export default function ReceiptInbox({ onClose, onChanged }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [files, setFiles] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    api
      .get('/expenses/receipts/inbox')
      .then((res) => setFiles(res.data.files))
      .catch((err) => {
        setFiles([]);
        toast(err.message, 'error');
      });
  }, [toast]);

  useEffect(load, [load]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !preview) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, preview]);

  async function handleFiles(fileList) {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;

    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = picked.filter((f) => f.size <= MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      toast(`${tooBig.length} file(s) skipped — receipts must be 5MB or smaller.`, 'error');
    }
    if (ok.length === 0) return;

    const form = new FormData();
    for (const f of ok) form.append('receipts', f);

    setUploading(true);
    setProgress(0);
    try {
      const res = await api.post('/expenses/receipts/inbox', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => setProgress(evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0),
      });
      toast(`${res.data.uploaded} receipt${res.data.uploaded === 1 ? '' : 's'} added to the inbox`, 'success');
      load();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function discard(filename) {
    try {
      await api.delete(`/expenses/receipts/inbox/${encodeURIComponent(filename)}`);
      setFiles((prev) => prev.filter((f) => f.filename !== filename));
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
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
          style={{ position: 'relative', width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}
        >
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
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
            }}
          >
            ×
          </button>

          <h2 style={{ margin: 0, fontSize: 20 }}>Receipt inbox</h2>
          <p style={{ color: 'var(--text-muted)', margin: '6px 0 18px', fontSize: 13.5 }}>
            Upload receipts here in bulk, then open any expense and pick one. It moves into that expense's
            year and category folder automatically.
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!uploading) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => !uploading && inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--violet)' : 'var(--border)'}`,
              borderRadius: 16,
              padding: 24,
              textAlign: 'center',
              cursor: uploading ? 'default' : 'pointer',
              background: dragOver ? 'rgba(139, 92, 246, 0.08)' : 'var(--bg-elevated)',
              transition: 'border-color 0.2s ease, background 0.2s ease',
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*,.heic,.heif,application/pdf"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
            {uploading ? (
              <>
                <div style={{ fontSize: 28 }}>⏳</div>
                <p style={{ marginTop: 8, fontWeight: 600 }}>Uploading… {progress}%</p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 30 }}>🧾</div>
                <p style={{ marginTop: 8, fontWeight: 600 }}>Drop receipts here</p>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  or click to browse — select as many as you like, images or PDF, 5MB each
                </p>
              </>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
              {files === null ? 'Loading…' : `${files.length} waiting to be assigned`}
            </div>

            {files !== null && files.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                The inbox is empty. Anything you upload will appear here until you attach it to an expense.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 12 }}>
                {(files || []).map((f) => (
                  <div key={f.filename} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      title={`${f.filename} — click to preview`}
                      onClick={() => setPreview(inboxFileUrl(f.filename))}
                      style={{
                        width: '100%',
                        height: 96,
                        padding: 0,
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        overflow: 'hidden',
                        background: 'var(--bg-elevated)',
                        cursor: 'pointer',
                        display: 'block',
                      }}
                    >
                      {isImageFilename(f.filename) ? (
                        <img
                          src={inboxFileUrl(f.filename)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 28 }}>
                          {placeholderFor(f.filename)}
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      title="Discard"
                      aria-label={`Discard ${f.filename}`}
                      onClick={() => discard(f.filename)}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 6,
                        border: 'none',
                        background: 'rgba(5, 6, 10, 0.66)',
                        color: '#fff',
                        fontSize: 13,
                        lineHeight: 1,
                        cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={f.filename}
                    >
                      {f.filename}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatSize(f.sizeBytes)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
      {preview && <ReceiptLightbox url={preview} onClose={() => setPreview(null)} />}
    </AnimatePresence>
  );
}
