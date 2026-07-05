import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import ReceiptDropzone from '../components/ReceiptDropzone.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';

export default function AddExpense() {
  const navigate = useNavigate();
  const toast = useToast();

  const [categories, setCategories] = useState([]);
  const [itemName, setItemName] = useState('');
  const [amount, setAmount] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [receiptStatus, setReceiptStatus] = useState('idle'); // idle | uploading | success | error
  const [receiptError, setReceiptError] = useState('');

  function onFileChange(next) {
    setFile(next);
    setReceiptStatus('idle');
    setReceiptError('');
  }

  useEffect(() => {
    api.get('/categories').then((res) => {
      setCategories(res.data.categories);
      if (res.data.categories[0]) setCategoryId(String(res.data.categories[0].id));
    });
  }, []);

  const formComplete = itemName.trim().length > 0 && Number(amount) > 0 && !!purchaseDate;

  async function onSubmit(e) {
    e.preventDefault();
    if (!formComplete) return;

    setSubmitting(true);
    setProgress(0);
    if (file) setReceiptStatus('uploading');

    const form = new FormData();
    form.append('itemName', itemName);
    form.append('amount', amount);
    form.append('purchaseDate', purchaseDate);
    form.append('categoryId', categoryId);
    form.append('notes', notes);
    if (file) form.append('receipt', file);

    try {
      await api.post('/expenses', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
          setProgress(pct);
        },
      });
      if (file) setReceiptStatus('success');
      setSubmitted(true);
      toast('Expense added', 'success');
      setTimeout(() => navigate('/'), 700);
    } catch (err) {
      if (file) {
        setReceiptStatus('error');
        setReceiptError(err.message);
      }
      toast(err.message, 'error');
      setSubmitting(false);
    }
  }

  const selectedCategory = categories.find((c) => String(c.id) === categoryId);

  function capitalizeWords(str) {
    return str.replace(/(^|\s)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Add expense</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Log a purchase and attach the receipt.</p>

      <form onSubmit={onSubmit} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <label className="label">What did you buy?</label>
          <input
            className="input"
            required
            maxLength={200}
            value={itemName}
            onChange={(e) => setItemName(capitalizeWords(e.target.value))}
            placeholder="e.g. Safety Boots"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Amount (AUD)</label>
            <input className="input" required type="number" min="0.01" max="999999.99" step="0.01" maxLength={10} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Date</label>
            <input className="input" required type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Category</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
          <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra detail for your records" />
        </div>

        <div>
          <label className="label">Receipt (optional)</label>
          <ReceiptDropzone
            file={file}
            onFileChange={onFileChange}
            uploadProgress={progress}
            status={receiptStatus}
            errorMessage={receiptError}
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting || submitted || !formComplete} style={{ marginTop: 4 }}>
          {submitting && !submitted && <span className="spinner" />}
          {submitted ? 'Saved ✓' : submitting ? 'Saving…' : 'Save expense'}
        </button>
      </form>
    </div>
  );
}
