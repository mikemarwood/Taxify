import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import CategoryBadge from './CategoryBadge.jsx';
import ReceiptDropzone from './ReceiptDropzone.jsx';

function capitalizeWords(str) {
  return str.replace(/(^|\s)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

export default function ExpenseModal({ expense, onClose, onSaved, onDeleted }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [itemName, setItemName] = useState(expense.itemName);
  const [amount, setAmount] = useState(String(expense.amount));
  const [purchaseDate, setPurchaseDate] = useState(expense.purchaseDate.slice(0, 10));
  const [categoryId, setCategoryId] = useState(expense.category ? String(expense.category.id) : '');
  const [notes, setNotes] = useState(expense.notes || '');
  const [file, setFile] = useState(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [progress, setProgress] = useState(0);
  const [receiptStatus, setReceiptStatus] = useState('idle');
  const [receiptError, setReceiptError] = useState('');

  useEffect(() => {
    if (editing && categories.length === 0) {
      api.get('/categories').then((res) => setCategories(res.data.categories));
    }
  }, [editing, categories.length]);

  function onFileChange(next) {
    setFile(next);
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
    form.append('purchaseDate', purchaseDate);
    form.append('categoryId', categoryId);
    form.append('notes', notes);
    if (file) form.append('receipt', file);
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
      await api.delete(`/expenses/${expense.id}`);
      toast('Expense deleted', 'success');
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
        onClick={onClose}
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
          style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}
          onClick={(e) => e.stopPropagation()}
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
                  <label className="label">Amount (AUD)</label>
                  <input
                    className="input"
                    required
                    type="number"
                    min="0.01"
                    max="999999.99"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
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
                <label className="label">Notes (optional)</label>
                <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div>
                <label className="label">Receipt</label>
                {expense.receiptUrl && !file && !removeReceipt ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 13 }}>
                      🧾 View current receipt
                    </a>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setRemoveReceipt(true)}>
                      Remove
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>{expense.itemName}</h2>
                <div style={{ fontSize: 22, fontWeight: 800, whiteSpace: 'nowrap' }}>${expense.amount.toFixed(2)}</div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <CategoryBadge category={expense.category} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {new Date(expense.purchaseDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                {expense.isRecurring && (
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>· {expense.frequency}</span>
                )}
              </div>

              {expense.notes && (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{expense.notes}</p>
              )}

              <div>
                {expense.receiptUrl ? (
                  <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 13 }}>
                    🧾 View attachment
                  </a>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No receipt attached</span>
                )}
              </div>

              {confirmingDelete ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>Delete this expense?</span>
                  <button className="btn btn-primary" style={{ background: 'var(--red)', fontSize: 13 }} disabled={busy} onClick={onDelete}>
                    {busy && <span className="spinner" />}
                    Confirm delete
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  <button className="btn btn-ghost" onClick={() => setConfirmingDelete(true)}>
                    Delete
                  </button>
                  <button className="btn btn-ghost" onClick={onClose}>
                    Close
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
