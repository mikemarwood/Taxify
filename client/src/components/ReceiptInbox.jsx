import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';
import CategoryBadge from './CategoryBadge.jsx';
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

function folderLabel(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortDate(value) {
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
}

function longDate(value) {
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
}

const EXPENSE_SORTS = {
  'date-desc': { label: 'Newest first', compare: (a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate) },
  'date-asc': { label: 'Oldest first', compare: (a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate) },
  'amount-desc': { label: 'Amount ↓', compare: (a, b) => b.amount - a.amount },
  'amount-asc': { label: 'Amount ↑', compare: (a, b) => a.amount - b.amount },
  name: { label: 'Name A–Z', compare: (a, b) => (a.itemName || '').localeCompare(b.itemName || '') },
  category: {
    label: 'Category A–Z',
    compare: (a, b) =>
      (a.category?.name || 'zzz').localeCompare(b.category?.name || 'zzz') ||
      new Date(b.purchaseDate) - new Date(a.purchaseDate),
  },
};

const FILE_SORTS = {
  newest: { label: 'Newest first', compare: (a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0) },
  oldest: { label: 'Oldest first', compare: (a, b) => new Date(a.modifiedAt || 0) - new Date(b.modifiedAt || 0) },
  name: { label: 'Name A–Z', compare: (a, b) => a.filename.localeCompare(b.filename) },
  largest: { label: 'Largest first', compare: (a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0) },
};

const MAX_ROWS = 300;

// Bulk staging area and assigner: upload receipts here, then drag each one
// onto the expense it belongs to. Dropping moves the file out of the inbox
// and into that expense's year/category folder — unless "keep a copy" is on,
// in which case it's copied so the same docket can cover several expenses.
export default function ReceiptInbox({ onClose, onChanged }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [files, setFiles] = useState(null);
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState('__all__');
  const [expenses, setExpenses] = useState(null);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [year, setYear] = useState('all');
  const [expenseSort, setExpenseSort] = useState('date-desc');
  const [fileSort, setFileSort] = useState('newest');

  const [dragOverZone, setDragOverZone] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);

  const [picked, setPicked] = useState(null); // receipt chosen by click (touch-friendly)
  const draggingRef = useRef(null); // receipt being dragged
  const [dropTarget, setDropTarget] = useState(null); // expense id under the pointer
  const [assigning, setAssigning] = useState(null);
  const [expanded, setExpanded] = useState(null); // expense id showing its details
  const [menu, setMenu] = useState(null); // right-click / drop menu: { x, y, kind, ... }
  // Expenses filed during this session. They'd otherwise vanish the moment
  // they're given a receipt, taking the confirmation and the filed-under path
  // with them, so they stay put until the dialog closes.
  const [justFiled, setJustFiled] = useState(() => new Set());

  const loadInbox = useCallback(() => {
    api
      .get('/expenses/receipts/inbox')
      .then((res) => {
        setFiles(res.data.files);
        setFolders(res.data.folders || []);
      })
      .catch((err) => {
        setFiles([]);
        toast(err.message, 'error');
      });
  }, [toast]);

  const loadExpenses = useCallback(() => {
    api
      .get('/expenses')
      .then((res) => setExpenses(res.data.expenses))
      .catch(() => setExpenses([]));
  }, []);

  useEffect(loadInbox, [loadInbox]);
  useEffect(loadExpenses, [loadExpenses]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (preview) return;
      if (picked) {
        setPicked(null);
        return;
      }
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, preview, picked]);

  async function handleFiles(fileList) {
    const all = Array.from(fileList || []);
    if (all.length === 0) return;

    const tooBig = all.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = all.filter((f) => f.size <= MAX_FILE_BYTES);
    if (tooBig.length > 0) toast(`${tooBig.length} file(s) skipped — receipts must be 5MB or smaller.`, 'error');
    if (ok.length === 0) return;

    const form = new FormData();
    for (const f of ok) {
      // A folder pick carries webkitRelativePath ("Receipts/Tooling/img.png").
      // Sending it as the field filename lets the server stage the file under
      // its folder; a plain file pick has no path and lands at the root.
      const rel = f.webkitRelativePath;
      if (rel && rel.includes('/')) form.append('receipts', f, rel);
      else form.append('receipts', f);
    }

    setUploading(true);
    setProgress(0);
    try {
      const res = await api.post('/expenses/receipts/inbox', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => setProgress(evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0),
      });
      toast(`${res.data.uploaded} receipt${res.data.uploaded === 1 ? '' : 's'} added`, 'success');
      loadInbox();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  }

  // `keep` is the copy-vs-move choice: copying leaves the original staged so
  // the same docket can cover the next expense too. Either way the file lands
  // in that expense's own year/category folder.
  async function assign(receipt, expense, keep) {
    if (!receipt || !expense) return;
    setDropTarget(null);
    // Attaching over an existing receipt deletes the old file when nothing
    // else points at it, so make that an explicit choice rather than a
    // mis-drop.
    if (
      expense.receiptUrl &&
      !window.confirm(`“${expense.itemName}” already has a receipt attached. Replace it with “${receipt.filename}”?`)
    ) {
      return;
    }

    setAssigning(expense.id);
    try {
      const res = await api.post(`/expenses/${expense.id}/receipt/from-inbox`, {
        filename: receipt.filename,
        folder: receipt.folder || undefined,
        keep: keep || undefined,
      });
      if (res.data.keptInInbox) {
        // Stays staged and stays selected, so the next expense is one click away.
        setPicked(receipt);
      } else {
        setFiles((prev) =>
          prev.filter((f) => !(f.filename === receipt.filename && (f.folder || '') === (receipt.folder || '')))
        );
        setPicked(null);
      }
      setJustFiled((prev) => new Set(prev).add(expense.id));
      setExpenses((prev) =>
        prev.map((e) =>
          e.id === expense.id
            ? {
                ...e,
                receiptUrl: `/api/expenses/${e.id}/receipt`,
                receiptFilename: res.data.filename,
                receiptPath: res.data.receiptPath,
              }
            : e
        )
      );
      toast(
        res.data.keptInInbox
          ? `Copied to “${expense.itemName}” — still in the inbox`
          : `Moved to “${expense.itemName}”`,
        'success'
      );
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAssigning(null);
    }
  }

  // A drop or a click on an expense asks whether to move or copy, unless a
  // modifier already said which — Ctrl copies, Shift moves, matching the
  // usual desktop drag conventions.
  function requestAssign(receipt, expense, evt) {
    if (!receipt || !expense) return;
    setDropTarget(null);
    if (evt?.ctrlKey || evt?.metaKey) return assign(receipt, expense, true);
    if (evt?.shiftKey) return assign(receipt, expense, false);
    setMenu({ kind: 'assign', x: evt.clientX, y: evt.clientY, receipt, expense });
  }

  async function discard(receipt) {
    try {
      await api.delete(`/expenses/receipts/inbox/${encodeURIComponent(receipt.filename)}`, {
        params: receipt.folder ? { folder: receipt.folder } : undefined,
      });
      setFiles((prev) =>
        prev.filter((f) => !(f.filename === receipt.filename && (f.folder || '') === (receipt.folder || '')))
      );
      if (picked && picked.filename === receipt.filename) setPicked(null);
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const visibleFiles = useMemo(() => {
    if (!files) return [];
    const list = activeFolder === '__all__' ? files : files.filter((f) => (f.folder || '') === activeFolder);
    return [...list].sort(FILE_SORTS[fileSort].compare);
  }, [files, activeFolder, fileSort]);

  const categories = useMemo(() => {
    const map = new Map();
    for (const e of expenses || []) if (e.category) map.set(e.category.id, e.category);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [expenses]);

  const years = useMemo(
    () => Array.from(new Set((expenses || []).map((e) => e.financialYear))).sort().reverse(),
    [expenses]
  );

  const matchingExpenses = useMemo(() => {
    // The list exists to find homes for staged receipts, so an expense that
    // already has one is noise — except the ones filed just now, which stay so
    // you can see where they landed.
    let list = (expenses || []).filter((e) => !e.receiptUrl || justFiled.has(e.id));
    if (categoryId !== 'all') list = list.filter((e) => String(e.category?.id) === categoryId);
    if (year !== 'all') list = list.filter((e) => e.financialYear === year);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.itemName?.toLowerCase().includes(q) ||
          e.notes?.toLowerCase().includes(q) ||
          String(e.amount).includes(q) ||
          (e.category?.name || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort(EXPENSE_SORTS[expenseSort].compare);
  }, [expenses, justFiled, categoryId, year, search, expenseSort]);

  // Rendering thousands of rows makes the drag laggy, so the list is capped —
  // visibly, with the total alongside, so a missing expense reads as "narrow
  // the search" rather than "it isn't there".
  const visibleExpenses = matchingExpenses.slice(0, MAX_ROWS);
  const missingCount = (expenses || []).filter((e) => !e.receiptUrl).length;

  const folderTabs = [
    { key: '__all__', label: `All (${files?.length || 0})` },
    ...folders.map((f) => ({ key: f.name, label: `${folderLabel(f.name)} (${f.count})` })),
  ];

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
          padding: 16,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="card"
          style={{ position: 'relative', width: '100%', maxWidth: 1080, height: '88vh', display: 'flex', flexDirection: 'column', padding: 22 }}
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
              zIndex: 2,
            }}
          >
            ×
          </button>

          <div style={{ flexShrink: 0, paddingRight: 40 }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>Receipt inbox</h2>
            <p style={{ color: 'var(--text-muted)', margin: '5px 0 14px', fontSize: 13 }}>
              {picked ? (
                <>
                  <strong style={{ color: 'var(--violet)' }}>“{picked.filename}”</strong> selected — click an expense and
                  choose move or copy.
                </>
              ) : (
                'Drag a receipt onto an expense (or click the receipt, then the expense) and choose move or copy. Hold Shift to move or Ctrl to copy without being asked. Right-click a receipt to preview it.'
              )}
            </p>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 4fr) minmax(320px, 5fr)',
              gap: 18,
            }}
          >
            {/* ---------------- left: staged receipts ---------------- */}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverZone(true);
                }}
                onDragLeave={() => setDragOverZone(false)}
                onDrop={(e) => {
                  // Only treat this as an upload when files come from outside.
                  if (draggingRef.current) return;
                  e.preventDefault();
                  setDragOverZone(false);
                  if (!uploading) handleFiles(e.dataTransfer.files);
                }}
                onClick={() => !uploading && inputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOverZone ? 'var(--violet)' : 'var(--border)'}`,
                  borderRadius: 12,
                  padding: 12,
                  textAlign: 'center',
                  cursor: uploading ? 'default' : 'pointer',
                  background: dragOverZone ? 'rgba(139, 92, 246, 0.08)' : 'var(--bg-elevated)',
                  flexShrink: 0,
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
                <input
                  ref={folderInputRef}
                  type="file"
                  webkitdirectory=""
                  directory=""
                  multiple
                  hidden
                  onChange={(e) => handleFiles(e.target.files)}
                />
                {uploading ? (
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Uploading… {progress}%</div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '5px 12px', fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        inputRef.current?.click();
                      }}
                    >
                      📄 Add files
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '5px 12px', fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        folderInputRef.current?.click();
                      }}
                    >
                      📁 Add a folder
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                  {files === null ? 'Loading…' : `${visibleFiles.length} staged`}
                </span>
                <select
                  className="input"
                  aria-label="Sort receipts"
                  value={fileSort}
                  onChange={(e) => setFileSort(e.target.value)}
                  style={{ fontSize: 12, padding: '5px 8px', width: 130 }}
                >
                  {Object.entries(FILE_SORTS).map(([key, s]) => (
                    <option key={key} value={key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {folders.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '10px 0 4px', flexShrink: 0 }}>
                  {folderTabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setActiveFolder(t.key)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '3px 9px',
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

              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 10, paddingRight: 4 }}>
                {files === null ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
                ) : visibleFiles.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {files.length === 0 ? 'The inbox is empty.' : 'Nothing in this folder.'}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 }}>
                    {visibleFiles.map((f) => {
                      const key = `${f.folder || ''}/${f.filename}`;
                      const isPicked = picked && picked.filename === f.filename && (picked.folder || '') === (f.folder || '');
                      return (
                        <div
                          key={key}
                          style={{ position: 'relative' }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ kind: 'receipt', x: e.clientX, y: e.clientY, receipt: f });
                          }}
                        >
                          <div
                            draggable
                            onDragStart={(e) => {
                              draggingRef.current = f;
                              e.dataTransfer.effectAllowed = 'copyMove';
                              e.dataTransfer.setData('text/plain', key);
                            }}
                            onDragEnd={() => {
                              draggingRef.current = null;
                              setDropTarget(null);
                            }}
                            onClick={() => setPicked(isPicked ? null : f)}
                            title={`${f.folder ? `${f.folder}/` : ''}${f.filename} — right-click for options`}
                            style={{
                              height: 88,
                              borderRadius: 10,
                              overflow: 'hidden',
                              border: isPicked ? '2px solid var(--violet)' : '1px solid var(--border)',
                              background: 'var(--bg-elevated)',
                              cursor: 'grab',
                            }}
                          >
                            {isImageFilename(f.filename) ? (
                              <img
                                src={inboxFileUrl(f.filename, f.folder)}
                                alt=""
                                draggable={false}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              />
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 26 }}>
                                {placeholderFor(f.filename)}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            title="Preview"
                            aria-label={`Preview ${f.filename}`}
                            onClick={() => setPreview({ url: inboxFileUrl(f.filename, f.folder), filename: f.filename })}
                            style={iconBtn({ left: 4 })}
                          >
                            🔍
                          </button>
                          <button
                            type="button"
                            title="Discard"
                            aria-label={`Discard ${f.filename}`}
                            onClick={() => discard(f)}
                            style={iconBtn({ right: 4 })}
                          >
                            ×
                          </button>
                          {activeFolder === '__all__' && f.folder && (
                            <span
                              style={{
                                position: 'absolute',
                                bottom: 32,
                                left: 4,
                                right: 4,
                                fontSize: 9,
                                fontWeight: 700,
                                padding: '2px 5px',
                                borderRadius: 5,
                                background: 'rgba(5, 6, 10, 0.72)',
                                color: '#fff',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              📁 {folderLabel(f.folder)}
                            </span>
                          )}
                          <div
                            style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={f.filename}
                          >
                            {f.filename}
                          </div>
                          <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{formatSize(f.sizeBytes)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ---------------- right: expenses ---------------- */}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <input
                className="input"
                placeholder="Search expenses…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: 13, padding: '8px 10px', flexShrink: 0 }}
              />
              <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexShrink: 0, flexWrap: 'wrap' }}>
                <select
                  className="input"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  style={{ fontSize: 12.5, padding: '6px 8px', flex: 1, minWidth: 120 }}
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  style={{ fontSize: 12.5, padding: '6px 8px', width: 110 }}
                >
                  <option value="all">All years</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  aria-label="Sort expenses"
                  value={expenseSort}
                  onChange={(e) => setExpenseSort(e.target.value)}
                  style={{ fontSize: 12.5, padding: '6px 8px', width: 130 }}
                >
                  {Object.entries(EXPENSE_SORTS).map(([key, s]) => (
                    <option key={key} value={key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>{missingCount} still need a receipt</span>
                <span style={{ marginLeft: 'auto' }}>
                  {matchingExpenses.length > MAX_ROWS
                    ? `showing ${MAX_ROWS} of ${matchingExpenses.length} — narrow the search`
                    : `${matchingExpenses.length} shown`}
                </span>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
                {expenses === null ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
                ) : visibleExpenses.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No expenses match this filter.</div>
                ) : (
                  visibleExpenses.map((e) => {
                    const isTarget = dropTarget === e.id;
                    const isOpen = expanded === e.id;
                    return (
                      <div key={e.id} style={{ marginBottom: 5 }}>
                        <div
                          onDragOver={(evt) => {
                            evt.preventDefault();
                            evt.dataTransfer.dropEffect = evt.ctrlKey || evt.metaKey ? 'copy' : 'move';
                            if (dropTarget !== e.id) setDropTarget(e.id);
                          }}
                          onDragLeave={() => setDropTarget((cur) => (cur === e.id ? null : cur))}
                          onDrop={(evt) => {
                            evt.preventDefault();
                            const receipt = draggingRef.current;
                            draggingRef.current = null;
                            requestAssign(receipt, e, evt);
                          }}
                          onClick={(evt) => (picked ? requestAssign(picked, e, evt) : setExpanded(isOpen ? null : e.id))}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 9,
                            padding: '8px 10px',
                            borderRadius: isOpen ? '9px 9px 0 0' : 9,
                            fontSize: 12.5,
                            border: `1px solid ${isTarget ? 'var(--violet)' : 'transparent'}`,
                            background: isTarget ? 'rgba(139, 92, 246, 0.14)' : 'var(--bg-elevated)',
                            cursor: 'pointer',
                            opacity: assigning === e.id ? 0.5 : 1,
                          }}
                        >
                          <span style={{ width: 62, flexShrink: 0, color: 'var(--text-muted)' }}>{shortDate(e.purchaseDate)}</span>
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.itemName}
                          </span>
                          <CategoryBadge category={e.category} />
                          <span
                            style={{ width: 16, textAlign: 'center' }}
                            title={justFiled.has(e.id) ? 'Filed just now — open ⓘ to see where' : 'No receipt yet'}
                          >
                            {justFiled.has(e.id) ? '✅' : '—'}
                          </span>
                          <span style={{ width: 64, textAlign: 'right', fontWeight: 700 }}>${e.amount.toFixed(2)}</span>
                          <button
                            type="button"
                            title="Where is this receipt filed?"
                            aria-label={`Details for ${e.itemName}`}
                            aria-expanded={isOpen}
                            onClick={(evt) => {
                              evt.stopPropagation();
                              setExpanded(isOpen ? null : e.id);
                            }}
                            style={{
                              flexShrink: 0,
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: isOpen ? 'var(--violet)' : 'var(--text-muted)',
                              fontSize: 11,
                              lineHeight: 1,
                              cursor: 'pointer',
                            }}
                          >
                            ⓘ
                          </button>
                        </div>

                        {isOpen && (
                          <ExpenseDetails
                            expense={e}
                            onPreview={() => setPreview({ url: e.receiptUrl, filename: e.receiptFilename || 'receipt' })}
                            onCopyPath={async () => {
                              try {
                                await navigator.clipboard.writeText(e.receiptPath);
                                toast('Path copied', 'success');
                              } catch {
                                toast('Could not copy — select the path and copy it manually', 'error');
                              }
                            }}
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
      {menu?.kind === 'receipt' && (
        <PopMenu
          x={menu.x}
          y={menu.y}
          title={menu.receipt.filename}
          onClose={() => setMenu(null)}
          items={[
            {
              label: '🔍 Preview (scroll to zoom)',
              onSelect: () =>
                setPreview({
                  url: inboxFileUrl(menu.receipt.filename, menu.receipt.folder),
                  filename: menu.receipt.filename,
                }),
            },
            {
              label: picked && picked.filename === menu.receipt.filename ? '✓ Selected' : '👆 Select for assigning',
              onSelect: () => setPicked(menu.receipt),
            },
            {
              label: '↗ Open in a new tab',
              onSelect: () =>
                window.open(inboxFileUrl(menu.receipt.filename, menu.receipt.folder), '_blank', 'noopener'),
            },
            { label: '🗑 Discard', danger: true, onSelect: () => discard(menu.receipt) },
          ]}
        />
      )}

      {menu?.kind === 'assign' && (
        <PopMenu
          x={menu.x}
          y={menu.y}
          title={`“${menu.receipt.filename}” → ${menu.expense.itemName}`}
          onClose={() => setMenu(null)}
          items={[
            {
              label: '📁 Move here',
              hint: 'files it under this expense and clears it from the inbox',
              onSelect: () => assign(menu.receipt, menu.expense, false),
            },
            {
              label: '📋 Copy here',
              hint: 'files a copy and keeps the original staged for other expenses',
              onSelect: () => assign(menu.receipt, menu.expense, true),
            },
          ]}
        />
      )}

      {preview && (
        <ReceiptLightbox url={preview.url} filename={preview.filename} onClose={() => setPreview(null)} />
      )}
    </AnimatePresence>
  );
}

// Small menu anchored at the pointer, for the right-click options on a receipt
// and the move/copy choice on a drop. Nudged back on-screen when it would run
// off the right or bottom edge.
function PopMenu({ x, y, title, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        // Same node as the dialog's own Escape handler, so plain
        // stopPropagation wouldn't keep the dialog from closing too.
        e.stopImmediatePropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div onClick={onClose} onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, zIndex: 1400 }}>
      <div
        ref={ref}
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: pos.left,
          top: pos.top,
          minWidth: 210,
          maxWidth: 300,
          padding: 5,
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
        }}
      >
        {title && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              padding: '5px 9px 7px',
              borderBottom: '1px solid var(--border)',
              marginBottom: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
        )}
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 9px',
              borderRadius: 7,
              border: 'none',
              background: 'transparent',
              color: item.danger ? 'var(--red, #ef4444)' : 'var(--text)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elevated)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ fontWeight: 600 }}>{item.label}</span>
            {item.hint && (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.hint}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// Where an expense's receipt actually lives on disk. Receipts are filed under
// <user>/<financial-year>/<category>, so the path is also the quickest way to
// confirm an expense was categorised the way you expected.
function ExpenseDetails({ expense, onPreview, onCopyPath }) {
  const segments = expense.receiptPath ? expense.receiptPath.split('/') : [];
  const filename = segments.pop();

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: '0 0 9px 9px',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderTop: 'none',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ color: 'var(--text-muted)' }}>
        {longDate(expense.purchaseDate)} · {expense.category?.name || 'Uncategorised'} · {expense.financialYear}
      </div>
      {expense.notes && <div style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{expense.notes}</div>}

      {/* Keyed off the receipt itself, not the path: an older server build
          returns no receiptPath, and "no receipt yet" would be a lie. */}
      {expense.receiptUrl ? (
        <>
          <div style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Receipt location
          </div>
          {expense.receiptPath ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontFamily: 'monospace', fontSize: 11.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>uploads</span>
              {segments.map((seg, i) => (
                <span key={i} style={{ color: 'var(--text-muted)' }}>
                  / {seg}
                </span>
              ))}
              <span>/ </span>
              <span style={{ fontWeight: 700, wordBreak: 'break-all' }}>{filename}</span>
            </div>
          ) : (
            <div style={{ fontFamily: 'monospace', fontSize: 11.5, wordBreak: 'break-all' }}>
              {expense.receiptFilename || 'Receipt attached'}
              <span style={{ fontFamily: 'inherit', color: 'var(--text-muted)' }}> — restart the server to see its full path</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={onPreview}>
              🔍 Preview
            </button>
            {expense.receiptPath && (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={onCopyPath}>
                Copy path
              </button>
            )}
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--text-muted)' }}>
          No receipt yet — it will be filed under{' '}
          <span style={{ fontFamily: 'monospace' }}>
            {expense.financialYear}/{(expense.category?.name || 'Uncategorised').toLowerCase()}
          </span>
          .
        </div>
      )}
    </div>
  );
}

function iconBtn(pos) {
  return {
    position: 'absolute',
    top: 4,
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    border: 'none',
    background: 'rgba(5, 6, 10, 0.66)',
    color: '#fff',
    fontSize: 11,
    lineHeight: 1,
    cursor: 'pointer',
    ...pos,
  };
}
