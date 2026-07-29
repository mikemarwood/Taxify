import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import CategoryBadge from './CategoryBadge.jsx';
import ReceiptDropzone from './ReceiptDropzone.jsx';
import ReceiptGallery from './ReceiptGallery.jsx';
import Toggle from './Toggle.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';
import ReceiptPreview from './ReceiptPreview.jsx';
import Icon from './Icon.jsx';
import { onDigitKeyDown, playOpen, playClose } from '../lib/sounds.js';
import { useAuth } from '../lib/AuthContext.jsx';

const CURRENCIES = ['AUD', 'USD', 'NZD', 'GBP', 'EUR'];

function capitalizeWords(str) {
  return str.replace(/(^|\s)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

function capitalizeSentences(str) {
  return str.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// Receipts are filed under <uploads>/<user>/<financial-year>/<category>, so
// the directory is both a way to find the file outside the app and a check
// that the expense is categorised the way you meant.
function ReceiptLocation({ expense }) {
  const toast = useToast();
  if (!expense.receiptDir && !expense.receiptFilename) return null;

  async function copy(value, what) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${what} copied`, 'success');
    } catch {
      toast('Could not copy — select the text and copy it manually', 'error');
    }
  }

  const boxStyle = {
    flex: 1,
    minWidth: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 11.5,
    lineHeight: 1.5,
    color: 'var(--text)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 7,
    padding: '7px 9px',
    wordBreak: 'break-all',
  };

  const copyButtonStyle = {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        Stored in
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={boxStyle}>{expense.receiptDir || 'Restart the server to see the full path'}</div>
        {expense.receiptDir && (
          <button type="button" title="Copy folder path" aria-label="Copy folder path" style={copyButtonStyle} onClick={() => copy(expense.receiptDir, 'Folder path')}>
            <Icon name="copy" size={14} />
          </button>
        )}
      </div>
      {expense.receiptFilename && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <div style={boxStyle}>{expense.receiptFilename}</div>
          <button
            type="button"
            title="Copy full file path"
            aria-label="Copy full file path"
            style={copyButtonStyle}
            onClick={() => copy(expense.receiptFullPath || expense.receiptFilename, 'Full path')}
          >
            <Icon name="copy" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default function ExpenseModal({ expense, onClose, onSaved, onDeleted }) {
  const { user } = useAuth();
  const readOnly = user?.role === 'accountant';
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Default on: deleting an expense and leaving its receipt behind is how
  // orphaned files accumulate. Opt out if you want it kept for a restore.
  const [alsoDeleteReceipt, setAlsoDeleteReceipt] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const [itemName, setItemName] = useState(expense.itemName);
  const [amount, setAmount] = useState(String(expense.amount));
  const [currency, setCurrency] = useState(expense.currency || 'AUD');
  const [purchaseDate, setPurchaseDate] = useState(expense.purchaseDate.slice(0, 10));
  const [categoryId, setCategoryId] = useState(expense.category ? String(expense.category.id) : '');
  const [isRecurring, setIsRecurring] = useState(!!expense.isRecurring);
  const [frequency, setFrequency] = useState(expense.frequency || 'monthly');
  const [notes, setNotes] = useState(expense.notes || '');
  const [file, setFile] = useState(null);
  const [pickedFilename, setPickedFilename] = useState(null);
  const [pickedSource, setPickedSource] = useState(null); // 'inbox' | 'folder'
  const [pickedFolder, setPickedFolder] = useState(''); // inbox subfolder, '' = root
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [progress, setProgress] = useState(0);
  const [receiptStatus, setReceiptStatus] = useState('idle');
  const [receiptError, setReceiptError] = useState('');

  // Paired with the open/close animation so the sound and the movement land
  // together; unmounting is when the dialog is actually going away.
  useEffect(() => {
    playOpen();
    return playClose;
  }, []);

  useEffect(() => {
    if (editing && categories.length === 0) {
      api.get('/categories').then((res) => setCategories(res.data.categories));
    }
  }, [editing, categories.length]);

  function onFileChange(next) {
    setFile(next);
    if (next) {
      setPickedFilename(null);
      setPickedSource(null);
    }
    setRemoveReceipt(false);
    setReceiptStatus('idle');
    setReceiptError('');
  }

  function onPickReceipt(filename, source, folder) {
    setPickedFilename(filename);
    setPickedSource(source || 'folder');
    setPickedFolder(folder || '');
    setFile(null);
    setRemoveReceipt(false);
    setReceiptStatus('idle');
    setReceiptError('');
  }

  const formComplete = itemName.trim().length > 0 && Number(amount) > 0 && !!purchaseDate;

  async function onSave(e) {
    e.preventDefault();
    if (!formComplete) return;

    setBusy(true);
    setProgress(0);
    if (file) setReceiptStatus('uploading');

    const form = new FormData();
    form.append('itemName', itemName);
    form.append('amount', amount);
    form.append('currency', currency);
    form.append('purchaseDate', purchaseDate);
    form.append('categoryId', categoryId);
    form.append('isRecurring', isRecurring);
    form.append('frequency', isRecurring ? frequency : '');
    form.append('notes', notes);
    if (file) form.append('receipt', file);
    else if (pickedFilename) {
      form.append('receiptFilename', pickedFilename);
      form.append('receiptSource', pickedSource || 'folder');
      if (pickedFolder) form.append('receiptFolder', pickedFolder);
    }
    if (removeReceipt) form.append('removeReceipt', 'true');

    try {
      await api.patch(`/expenses/${expense.id}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
          setProgress(pct);
        },
      });
      if (file) setReceiptStatus('success');
      toast('Expense updated', 'success');
      onSaved();
    } catch (err) {
      if (file) {
        setReceiptStatus('error');
        setReceiptError(err.message);
      }
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      const res = await api.delete(`/expenses/${expense.id}`, {
        params: alsoDeleteReceipt ? { deleteReceipt: 'true' } : undefined,
      });
      toast(res.data?.receiptDeleted ? 'Moved to Recycle Bin, receipt deleted' : 'Moved to Recycle Bin', 'success');
      onDeleted();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  const selectedCategory = categories.find((c) => String(c.id) === categoryId);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(16, 24, 40, 0.32)',
          backdropFilter: 'blur(4px)',
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
          style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}
        >
          {editing ? (
            <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Edit expense</h2>
              <div>
                <label className="label">What did you buy?</label>
                <input
                  className="input"
                  required
                  maxLength={200}
                  value={itemName}
                  onChange={(e) => setItemName(capitalizeWords(e.target.value))}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label className="label">Amount</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input"
                      required
                      type="number"
                      min="0.01"
                      max="999999.99"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={onDigitKeyDown}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 90 }}>
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Date</label>
                  <input className="input" required type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {selectedCategory && (
                  <div style={{ marginTop: 8 }}>
                    <CategoryBadge category={selectedCategory} />
                  </div>
                )}
              </div>
              <div>
                <Toggle checked={isRecurring} onChange={setIsRecurring} label="Recurring expense" />
                {isRecurring && (
                  <select className="input" style={{ marginTop: 8 }} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                )}
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(capitalizeSentences(e.target.value))} />
              </div>
              <div>
                <label className="label">Receipt</label>
                {expense.receiptUrl && !file && !pickedFilename && !removeReceipt ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }} onClick={() => setLightboxOpen(true)}>
                      <Icon name="receipt" size={15} />
                      View current receipt
                    </button>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setRemoveReceipt(true)}>
                      Remove
                    </button>
                  </div>
                ) : pickedFilename ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '10px 14px',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      background: 'var(--bg-elevated)',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <Icon name="receipt" size={15} />
                      {pickedSource === 'inbox' ? 'Moving from inbox' : 'Using existing receipt'}: {pickedFilename}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => {
                        setPickedFilename(null);
                        setPickedSource(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <ReceiptDropzone
                    file={file}
                    onFileChange={onFileChange}
                    uploadProgress={progress}
                    status={receiptStatus}
                    errorMessage={receiptError}
                  />
                )}
                <ReceiptGallery
                  categoryId={categoryId}
                  categoryName={selectedCategory?.name || expense.category?.name}
                  purchaseDate={purchaseDate}
                  currentFilename={expense.receiptFilename}
                  onPick={onPickReceipt}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn btn-primary" type="submit" disabled={busy || !formComplete} style={{ flex: 1 }}>
                  {busy && <span className="spinner" />}
                  Save changes
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 16,
                  paddingBottom: 18,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                    Expense Record · #{expense.id}
                  </div>
                  <h2 style={{ margin: 0, fontSize: 21, lineHeight: 1.3, wordBreak: 'break-word' }}>{expense.itemName}</h2>
                  <div style={{ marginTop: 10 }}>
                    <CategoryBadge category={expense.category} />
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, whiteSpace: 'nowrap' }}>{expense.amount.toFixed(2)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{expense.currency || 'AUD'}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 16, columnGap: 16 }}>
                <DetailRow
                  label="Purchase date"
                  value={new Date(expense.purchaseDate).toLocaleDateString(undefined, {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                />
                <DetailRow label="Category" value={expense.category?.name || 'Uncategorised'} />
                <DetailRow
                  label="Recurring"
                  value={expense.isRecurring ? `Yes · ${expense.frequency}` : 'No'}
                />
                {expense.autoGenerated && <DetailRow label="Added automatically" value="Yes" />}
                {expense.createdAt && (
                  <DetailRow
                    label="Added on"
                    value={new Date(expense.createdAt).toLocaleDateString(undefined, {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  />
                )}
              </div>

              {expense.notes && (
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                    Notes
                  </div>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{expense.notes}</p>
                </div>
              )}

              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Receipt
                </div>
                {expense.receiptUrl ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <ReceiptPreview
                      url={expense.receiptUrl}
                      filename={expense.receiptFilename}
                      onOpen={() => setLightboxOpen(true)}
                    />
                    <ReceiptLocation expense={expense} />
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No receipt attached</span>
                )}
              </div>

              {confirmingDelete ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Move this expense to the Recycle Bin? You can restore it any time within 30 days, after which it's
                    deleted permanently.
                  </span>

                  {expense.receiptUrl && (
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 9,
                        fontSize: 13,
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={alsoDeleteReceipt}
                        onChange={(e) => setAlsoDeleteReceipt(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        <span style={{ fontWeight: 600 }}>Delete the receipt file too</span>
                        <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: 2 }}>
                          {alsoDeleteReceipt
                            ? `“${expense.receiptFilename}” is removed from disk now — restoring this expense won't bring it back. Kept if another expense still uses it.`
                            : 'The file stays on disk until the expense is purged from the Recycle Bin in 30 days.'}
                        </span>
                      </span>
                    </label>
                  )}

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-primary" style={{ background: 'var(--red)', fontSize: 13, flex: 1 }} disabled={busy} onClick={onDelete}>
                      {busy && <span className="spinner" />}
                      Move to Recycle Bin
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  {!readOnly && (
                    <>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setEditing(true)}>
                        Edit
                      </button>
                      <button className="btn btn-ghost" onClick={() => setConfirmingDelete(true)}>
                        Delete
                      </button>
                    </>
                  )}
                  <button className="btn btn-ghost" style={readOnly ? { flex: 1 } : undefined} onClick={onClose}>
                    Close
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
      {lightboxOpen && expense.receiptUrl && (
        <ReceiptLightbox
          url={expense.receiptUrl}
          filename={expense.receiptFilename}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </AnimatePresence>
  );
}
