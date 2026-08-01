import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import ReceiptDropzone from '../components/ReceiptDropzone.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';
import Toggle from '../components/Toggle.jsx';
import Icon from '../components/Icon.jsx';
import { financialYearOf } from '../lib/financialYear.js';
import { onDigitKeyDown, playSuccess } from '../lib/sounds.js';
import { formatMoney } from '../lib/money.js';
import { useAuth } from '../lib/AuthContext.jsx';

const CURRENCIES = ['AUD', 'USD', 'NZD', 'GBP', 'EUR'];

export default function AddExpense() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [categories, setCategories] = useState([]);
  const [itemName, setItemName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState('monthly');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(null);
  const [receiptStatus, setReceiptStatus] = useState('idle'); // idle | uploading | success | error
  const [receiptError, setReceiptError] = useState('');

  function onFileChange(next) {
    setFile(next);
    setReceiptStatus('idle');
    setReceiptError('');
  }

  // Categories belong to a financial year, so the list follows the date on the
  // form — backdating a receipt into last year offers last year's categories,
  // which is the only set that can file it correctly.
  const categoryYear = financialYearOf(purchaseDate, user?.financialYearRule);

  useEffect(() => {
    api.get(`/categories?financialYear=${encodeURIComponent(categoryYear)}`).then((res) => {
      const next = res.data.categories;
      setCategoryId((current) => {
        // Carry the choice across by name where the year has one — changing
        // the date shouldn't quietly refile the expense under something else.
        const previous = categories.find((c) => String(c.id) === String(current));
        const match = previous && next.find((c) => c.name === previous.name);
        if (match) return String(match.id);
        return next[0] ? String(next[0].id) : '';
      });
      setCategories(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryYear]);

  function onItemNameChange(value) {
    setItemName(capitalizeWords(value));
  }

  // Asked of the server, which scores what was typed against everything this
  // account has actually filed — so "Bunnings Warehouse Chatswood" is
  // recognised from "Bunnings Warehouse Hornsby" instead of being treated as
  // something never seen before. Debounced, and it never overrides a category
  // chosen by hand.
  useEffect(() => {
    if (categoryTouched) return undefined;
    const typed = itemName.trim();
    if (typed.length < 2 || categories.length === 0) {
      setSuggestion(null);
      return undefined;
    }

    const id = setTimeout(() => {
      api
        .get(`/expenses/suggest-category?itemName=${encodeURIComponent(typed)}`)
        .then((res) => {
          const s = res.data.suggestion;
          // Categories belong to a financial year, so this comes back as a
          // name and is matched against the year being filed into.
          const match = s && categories.find((c) => c.name === s.categoryName);
          if (!match) return setSuggestion(null);
          setSuggestion(s);
          setCategoryId(String(match.id));
        })
        .catch(() => setSuggestion(null));
    }, 350);

    return () => clearTimeout(id);
  }, [itemName, categoryTouched, categories]);

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
    form.append('currency', currency);
    form.append('purchaseDate', purchaseDate);
    form.append('categoryId', categoryId);
    form.append('isRecurring', isRecurring);
    form.append('frequency', isRecurring ? frequency : '');
    form.append('notes', notes);
    if (file) form.append('receipt', file);

    try {
      const res = await api.post('/expenses', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
          setProgress(pct);
        },
      });
      if (file) setReceiptStatus('success');
      // Held on screen with its reference before moving on. A toast that
      // vanishes in three seconds is a poor receipt for the one action in the
      // app that is meant to leave a record — and if a receipt was attached,
      // this is where you find out it actually landed.
      setSaved({
        id: res.data?.id,
        itemName: itemName.trim(),
        amount: Number(amount),
        hadReceipt: !!file,
      });
      setSubmitted(true);
      playSuccess();
      setTimeout(() => navigate('/'), 2600);
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

  function capitalizeSentences(str) {
    return str.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
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
            onChange={(e) => onItemNameChange(e.target.value)}
            placeholder="e.g. Safety Boots"
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
                maxLength={10}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={onDigitKeyDown}
                placeholder="0.00"
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
          <select
            className="input"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setCategoryTouched(true);
              setCategoryAutoSuggested(false);
            }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {/* Says what it learned from, so the guess can be judged rather than
              just trusted. Choosing a category by hand silences it for good on
              this entry. */}
          {suggestion && !categoryTouched && (
            <div
              style={{
                marginTop: 7,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 7,
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}
            >
              <Icon name="pointer" size={13} style={{ marginTop: 2, flexShrink: 0, color: 'var(--accent)' }} />
              <span>
                Chosen from your past expenses
                {suggestion.example && (
                  <>
                    {' '}
                    — you filed <strong style={{ color: 'var(--text)' }}>{suggestion.example}</strong> here
                    {suggestion.timesUsed > 1 ? ` ${suggestion.timesUsed} times` : ''}
                  </>
                )}
                . Change it if that's not right.
              </span>
            </div>
          )}
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
          <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(capitalizeSentences(e.target.value))} placeholder="Any extra detail for your records" />
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
          {submitted ? 'Saved' : submitting ? 'Saving…' : 'Save expense'}
        </button>
      </form>

      {/* The confirmation, with the reference to quote if it ever has to be
          found again. */}
      <AnimatePresence>
        {saved && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="card"
            style={{
              marginTop: 18,
              padding: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              borderLeft: '4px solid var(--emerald)',
            }}
          >
            <motion.span
              initial={{ scale: 0.5, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 16 }}
              style={{
                width: 46,
                height: 46,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(12, 115, 67, 0.12)',
                color: 'var(--emerald)',
                flexShrink: 0,
              }}
            >
              <Icon name="check-circle" size={26} />
            </motion.span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {saved.itemName} saved — {formatMoney(saved.amount)}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  alignItems: 'center',
                  marginTop: 5,
                  fontSize: 12.5,
                  color: 'var(--text-muted)',
                }}
              >
                {saved.id && (
                  <span
                    title="The reference for this expense"
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'var(--bg-inset)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    #{String(saved.id).padStart(5, '0')}
                  </span>
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon name={saved.hadReceipt ? 'receipt' : 'info'} size={13} />
                  {saved.hadReceipt ? 'Receipt attached and filed' : 'No receipt attached'}
                </span>
              </div>
            </div>

            <span className="spinner" title="Returning to your dashboard" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
