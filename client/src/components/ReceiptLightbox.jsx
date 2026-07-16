import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ReceiptLightbox({ url, onClose }) {
  const [imgError, setImgError] = useState(false);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 6, 10, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1300,
          padding: 20,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="card"
          style={{ maxWidth: '90vw', maxHeight: '90vh', padding: 16, overflow: 'auto' }}
          onClick={(e) => e.stopPropagation()}
        >
          {imgError ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)' }}>Preview not available for this file type.</p>
              <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary">
                Open receipt
              </a>
            </div>
          ) : (
            <img
              src={url}
              alt="Receipt"
              style={{ maxWidth: '85vw', maxHeight: '75vh', display: 'block', borderRadius: 8 }}
              onError={() => setImgError(true)}
            />
          )}
          <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: 12, width: '100%' }}>
            Close
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
