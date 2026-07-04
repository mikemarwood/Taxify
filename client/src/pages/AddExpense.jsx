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
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.get('/categories').then((res) => {
      setCategories(res.data.categories);
      if (res.data.categories[0]) setCategoryId(String(res.data.categories[0].id));
    });
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setUploading(true);
    setProgress(0);

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
      setSubmitted(true);
      toast('Expense added', 'success');
      setTimeout(() => navigate('/'), 700);
    } catch (err) {
      toast(err.message, 'error');
      setUploading(false);
    }
  }

  const selectedCategory = categories.find((c) => String(c.id) === categoryId);

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Add expense</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Log a purchase and attach the receipt.</p>

      <form onSubmit={onSubmit} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <label className="label">What did you buy?</label>
          <input className="input" required value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Safety boots" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Amount (AUD)</label>
            <input className="input" required type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
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
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra detail for your records" />
        </div>

        <div>
          <label className="label">Receipt</label>
          <ReceiptDropzone file={file} onFileChange={setFile} uploadProgress={progress} uploading={uploading} />
        </div>

        <button className="btn btn-primary" type="submit" disabled={uploading} style={{ marginTop: 4 }}>
          {uploading && !submitted && <span className="spinner" />}
          {submitted ? 'Saved ✓' : uploading ? 'Saving…' : 'Save expense'}
        </button>
      </form>
    </div>
  );
}
