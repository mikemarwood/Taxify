import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ReceiptDropzone({ file, onFileChange, uploadProgress, uploading }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = useCallback(
    (files) => {
      if (files && files[0]) onFileChange(files[0]);
    },
    [onFileChange]
  );

  const preview = file ? URL.createObjectURL(file) : null;
  const isImage = file && file.type.startsWith('image/');
  const offset = CIRCUMFERENCE - (uploadProgress / 100) * CIRCUMFERENCE;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !uploading && inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? 'var(--violet)' : 'var(--border)'}`,
        borderRadius: 16,
        padding: 28,
        textAlign: 'center',
        cursor: uploading ? 'default' : 'pointer',
        background: dragOver ? 'rgba(139, 92, 246, 0.08)' : 'var(--bg-elevated)',
        transition: 'border-color 0.2s ease, background 0.2s ease',
        position: 'relative',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      <AnimatePresence mode="wait">
        {uploading ? (
          <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <svg width="64" height="64" viewBox="0 0 64 64" style={{ margin: '0 auto', display: 'block' }}>
              <circle className="progress-ring-track" cx="32" cy="32" r={RADIUS} strokeWidth="5" />
              <circle
                className="progress-ring-bar"
                cx="32"
                cy="32"
                r={RADIUS}
                strokeWidth="5"
                stroke="url(#grad)"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={offset}
                transform="rotate(-90 32 32)"
              />
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
              <text x="32" y="37" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">
                {uploadProgress}%
              </text>
            </svg>
            <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>Uploading receipt…</p>
          </motion.div>
        ) : file ? (
          <motion.div key="preview" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            {isImage ? (
              <img src={preview} alt="Receipt preview" style={{ maxHeight: 140, borderRadius: 10, margin: '0 auto', display: 'block' }} />
            ) : (
              <div style={{ fontSize: 40 }}>📄</div>
            )}
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>{file.name}</p>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 10, padding: '6px 14px', fontSize: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
              }}
            >
              Remove
            </button>
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div style={{ fontSize: 32 }}>🧾</div>
            <p style={{ marginTop: 8, fontWeight: 600 }}>Drop a receipt here</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>or click to browse — images or PDF</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
