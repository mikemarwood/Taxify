import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Not assigned' },
  { key: 'assigned', label: 'Assigned' },
];

function isImageFilename(name) {
  return /\.(jpe?g|png|webp|gif)$/i.test(name);
}

function fileUrl(categoryId, purchaseDate, filename) {
  const params = new URLSearchParams({ purchaseDate, filename });
  if (categoryId) params.set('categoryId', categoryId);
  return `/api/expenses/receipts/file?${params.toString()}`;
}

export default function ReceiptGallery({ categoryId, purchaseDate, currentFilename, onPick }) {
  const toast = useToast();
  const [files, setFiles] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!purchaseDate) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setFiles(null);
    setError('');
    api
      .get('/expenses/receipts/browse', { params: { categoryId: categoryId || undefined, purchaseDate } })
      .then((res) => {
        if (!cancelled) setFiles(res.data.files);
      })
      .catch((err) => {
        if (!cancelled) {
          setFiles([]);
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, purchaseDate]);

  if (!purchaseDate) return null;
  if (files === null) {
    return <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '10px 0' }}>Loading existing receipts…</div>;
  }
  if (error) {
    return <div style={{ fontSize: 12.5, color: 'var(--red)', padding: '10px 0' }}>{error}</div>;
  }
  if (files.length === 0) return null;

  const visible = files.filter((f) => {
    if (filter === 'unassigned') return !f.assigned || f.filename === currentFilename;
    if (filter === 'assigned') return f.assigned && f.filename !== currentFilename;
    return true;
  });

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Existing receipts in this folder
        </span>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-elevated)', borderRadius: 8, padding: 3 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: filter === f.key ? 'var(--violet)' : 'transparent',
                color: filter === f.key ? '#fff' : 'var(--text-muted)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 0' }}>No receipts match this filter.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 10 }}>
          {visible.map((f) => {
            const isCurrent = f.filename === currentFilename;
            const locked = f.assigned && !isCurrent;
            return (
              <button
                key={f.filename}
                type="button"
                title={locked ? `Linked to "${f.assignedTo.itemName}"` : f.filename}
                onClick={() => {
                  if (locked) {
                    toast(`Already linked to "${f.assignedTo.itemName}"`, 'info');
                    return;
                  }
                  onPick(f.filename);
                }}
                style={{
                  position: 'relative',
                  padding: 0,
                  border: isCurrent ? '2px solid var(--violet)' : '1px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: locked ? 'default' : 'pointer',
                  background: 'var(--bg-elevated)',
                  height: 84,
                  opacity: locked ? 0.5 : 1,
                }}
              >
                {isImageFilename(f.filename) ? (
                  <img
                    src={fileUrl(categoryId, purchaseDate, f.filename)}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 26 }}>📄</div>
                )}
                {locked && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      fontSize: 9.5,
                      fontWeight: 700,
                      textAlign: 'center',
                      padding: '2px 3px',
                      background: 'rgba(5, 6, 10, 0.72)',
                      color: '#fff',
                    }}
                  >
                    Assigned
                  </span>
                )}
                {isCurrent && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: '#fff',
                      background: 'var(--violet)',
                      borderRadius: 5,
                      padding: '1px 5px',
                    }}
                  >
                    Current
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
