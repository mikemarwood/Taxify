import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import ReceiptLightbox from './ReceiptLightbox.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unused' },
  { key: 'assigned', label: 'In use' },
];

function isImageFilename(name) {
  return /\.(jpe?g|png|webp|gif)$/i.test(name);
}

// HEIC/HEIF upload and download fine, but Chrome and Firefox can't decode them
// in an <img>, so they get a placeholder tile instead of a broken image.
function isHeicFilename(name) {
  return /\.(heic|heif)$/i.test(name);
}

function placeholderFor(filename) {
  return isHeicFilename(filename) ? '🖼' : '📄';
}

export function folderFileUrl(categoryId, purchaseDate, filename) {
  const params = new URLSearchParams({ purchaseDate, filename });
  if (categoryId) params.set('categoryId', categoryId);
  return `/api/expenses/receipts/file?${params.toString()}`;
}

export function inboxFileUrl(filename, folder) {
  const params = new URLSearchParams({ filename });
  if (folder) params.set('folder', folder);
  return `/api/expenses/receipts/inbox/file?${params.toString()}`;
}

// Staged folders are slugified category names ("Home Rental" -> "home-rental"),
// so an expense's category can pick out its own folder automatically.
export function folderSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function folderLabel(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function SectionLabel({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {children}
      </span>
      {right}
    </div>
  );
}

// A single thumbnail. Clicking the tile selects the receipt; the magnifier
// opens the full-size preview without changing the selection.
function Thumb({ url, filename, selected, dimmed, badge, onSelect, onPreview, title }) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        title={title || filename}
        onClick={onSelect}
        style={{
          position: 'relative',
          width: '100%',
          padding: 0,
          border: selected ? '2px solid var(--violet)' : '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
          cursor: dimmed ? 'default' : 'pointer',
          background: 'var(--bg-elevated)',
          height: 84,
          opacity: dimmed ? 0.5 : 1,
          display: 'block',
        }}
      >
        {isImageFilename(filename) ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 26 }}>
            {placeholderFor(filename)}
          </div>
        )}
        {badge && (
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
            {badge}
          </span>
        )}
      </button>
      <button
        type="button"
        title="Preview"
        aria-label={`Preview ${filename}`}
        onClick={(e) => {
          e.stopPropagation();
          onPreview();
        }}
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          border: 'none',
          background: 'rgba(5, 6, 10, 0.66)',
          color: '#fff',
          fontSize: 11,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        🔍
      </button>
    </div>
  );
}

export default function ReceiptGallery({ categoryId, categoryName, purchaseDate, currentFilename, onPick, refreshToken }) {
  const [files, setFiles] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [inboxFolders, setInboxFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(undefined); // undefined = not chosen yet
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/expenses/receipts/inbox')
      .then((res) => {
        if (cancelled) return;
        setInbox(res.data.files);
        setInboxFolders(res.data.folders || []);
      })
      .catch(() => {
        if (!cancelled) {
          setInbox([]);
          setInboxFolders([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // Land on the folder matching this expense's category when there is one, so
  // a Tooling expense opens straight onto the Tooling receipts.
  useEffect(() => {
    if (activeFolder !== undefined || inboxFolders.length === 0) return;
    const wanted = folderSlug(categoryName);
    setActiveFolder(wanted && inboxFolders.some((f) => f.name === wanted) ? wanted : '__all__');
  }, [categoryName, inboxFolders, activeFolder]);

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
  }, [categoryId, purchaseDate, refreshToken]);

  if (!purchaseDate) return null;

  const visible = (files || []).filter((f) => {
    if (filter === 'unassigned') return !f.assigned || f.filename === currentFilename;
    if (filter === 'assigned') return f.assigned && f.filename !== currentFilename;
    return true;
  });

  const hasInbox = inbox.length > 0;
  const hasFolder = files !== null && files.length > 0;
  if (!hasInbox && !hasFolder && files !== null && !error) return null;

  const rootCount = inbox.filter((f) => !f.folder).length;
  const visibleInbox =
    activeFolder === undefined || activeFolder === '__all__'
      ? inbox
      : inbox.filter((f) => (f.folder || '') === activeFolder);

  const folderTabs = [
    { key: '__all__', label: `All (${inbox.length})` },
    ...inboxFolders.map((f) => ({ key: f.name, label: `${folderLabel(f.name)} (${f.count})` })),
    ...(rootCount > 0 && inboxFolders.length > 0 ? [{ key: '', label: `Unsorted (${rootCount})` }] : []),
  ];

  return (
    <div style={{ marginTop: 12 }}>
      {hasInbox && (
        <div style={{ marginBottom: hasFolder ? 16 : 0 }}>
          <SectionLabel>Receipt inbox · {inbox.length} waiting</SectionLabel>

          {inboxFolders.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {folderTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveFolder(t.key)}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: activeFolder === t.key ? 'var(--violet)' : 'var(--bg-elevated)',
                    color: activeFolder === t.key ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {visibleInbox.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 0' }}>
              Nothing staged in this folder.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 10 }}>
              {visibleInbox.map((f) => (
                <Thumb
                  key={`${f.folder || ''}/${f.filename}`}
                  url={inboxFileUrl(f.filename, f.folder)}
                  filename={f.filename}
                  selected={f.filename === currentFilename}
                  badge={f.folder ? folderLabel(f.folder) : 'Inbox'}
                  title={`${f.folder ? `${f.folder}/` : ''}${f.filename} — moves into this expense's folder when you save`}
                  onSelect={() => onPick(f.filename, 'inbox', f.folder || '')}
                  onPreview={() => setPreview({ url: inboxFileUrl(f.filename, f.folder), filename: f.filename })}
                />
              ))}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
            Picking one moves it out of the inbox and into this expense's folder when you save.
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12.5, color: 'var(--red)', padding: '10px 0' }}>{error}</div>}

      {files === null ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '10px 0' }}>Loading existing receipts…</div>
      ) : (
        hasFolder && (
          <div>
            <SectionLabel
              right={
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
              }
            >
              Already in this folder
            </SectionLabel>

            {visible.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 0' }}>No receipts match this filter.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 10 }}>
                {visible.map((f) => {
                  const isCurrent = f.filename === currentFilename;
                  const usedBy = f.usedBy || (f.assignedTo ? [f.assignedTo] : []);
                  // Others already use this receipt. That's allowed — one
                  // docket often covers several line items — so it stays
                  // selectable and just says who else is on it.
                  const sharedWith = usedBy.filter((u) => u.itemName !== undefined && !isCurrent);
                  return (
                    <Thumb
                      key={f.filename}
                      url={folderFileUrl(categoryId, purchaseDate, f.filename)}
                      filename={f.filename}
                      selected={isCurrent}
                      badge={isCurrent ? 'Current' : sharedWith.length > 0 ? `Used ×${sharedWith.length}` : null}
                      title={
                        sharedWith.length > 0
                          ? `${f.filename}\nAlso on: ${sharedWith.map((u) => u.itemName).join(', ')}`
                          : f.filename
                      }
                      onSelect={() => onPick(f.filename, 'folder', '')}
                      onPreview={() =>
                        setPreview({ url: folderFileUrl(categoryId, purchaseDate, f.filename), filename: f.filename })
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        )
      )}

      {preview && (
        <ReceiptLightbox url={preview.url} filename={preview.filename} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
