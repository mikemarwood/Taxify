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
import { useEntities } from '../lib/EntityContext.jsx';
import { onDigitKeyDown, playSuccess } from '../lib/sounds.js';
import { formatMoney, amountWhileTyping, amountOnBlur, parseAmount, currencySymbol } from '../lib/money.js';
import { useAuth } from '../lib/AuthContext.jsx';

const CURRENCIES = ['AUD', 'USD', 'NZD', 'GBP', 'EUR'];

// Long enough to say what something was, short enough to stay a line in a
// list. The amount ceiling is the same one the server enforces.
const ITEM_MIN = 2;
const ITEM_MAX = 200;
const NOTES_MAX = 1000;
const AMOUNT_MAX = 999999.99;

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
  // A rate the person states themselves, which beats the fetched one — it may
  // be what their bank actually charged.
  const [manualRate, setManualRate] = useState('');
  const [businessUsePct, setBusinessUsePct] = useState('100');
  const { entities, entity: selectedEntity, fallbackId, isAll, showSwitcher } = useEntities();
  const [entityId, setEntityId] = useState('');

  // Everything is a way of looking, not a place to file — so when no books are
  // selected the form asks, defaulting to the account's own.
  useEffect(() => {
    setEntityId((current) => current || (fallbackId ? String(fallbackId) : ''));
  }, [fallbackId]);

  const filingInto = entities.find((e) => String(e.id) === String(entityId)) || selectedEntity || null;
  // Business use is only a question for a business. Somebody with no business
  // should never be asked what percentage of their groceries was work.
  const asksBusinessUse = filingInto?.kind === 'business';
  const [conversion, setConversion] = useState({ loading: false, error: null, baseAmount: null, rate: null });
  // What was agreed, or null. Held as the figure itself rather than a flag, so
  // it cannot drift out of step with what was on screen when it was pressed.
  const [confirmedBase, setConfirmedBase] = useState(null);
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

  const baseCurrency = user?.currency || 'AUD';
  const foreignCurrency = currency !== baseCurrency;

  // Quoted by the server so the preview and the save can never disagree. Only
  // asked when there is something to convert.
  useEffect(() => {
    if (!foreignCurrency || !(amountValue > 0) || !purchaseDate) {
      setConversion({ loading: false, error: null, baseAmount: null, rate: null });
      return undefined;
    }
    setConversion((c) => ({ ...c, loading: true }));
    const id = setTimeout(() => {
      const params = new URLSearchParams({ amount: String(amount), currency, purchaseDate });
      if (manualRate) params.set('fxRate', manualRate);
      api
        .get(`/expenses/fx-quote?${params.toString()}`)
        .then((res) =>
          setConversion({
            loading: false,
            error: res.data.error || null,
            baseAmount: res.data.baseAmount ?? null,
            rate: res.data.rate ?? null,
          })
        )
        .catch((err) => setConversion({ loading: false, error: err.message, baseAmount: null, rate: null }));
    }, 400);
    return () => clearTimeout(id);
  }, [foreignCurrency, amount, currency, purchaseDate, manualRate]);

  // The amount, the currency, the date and the rate all feed the conversion, so
  // any of them changing means the confirmed figure describes something else.
  useEffect(() => {
    setConfirmedBase(null);
  }, [amount, currency, purchaseDate, manualRate]);

  // Only complained about once something has been typed, so an untouched form
  // is not covered in red before anybody has done anything wrong.
  // The number behind the grouped text in the field. Number('3,350.00') is
  // NaN, so nothing may read the raw string as a number.
  const amountValue = parseAmount(amount) ?? 0;

  const itemIssue = itemName.trim() && itemName.trim().length < ITEM_MIN ? `At least ${ITEM_MIN} characters` : '';
  const amountIssue = Boolean(amount.trim()) && !(amountValue > 0 && amountValue <= AMOUNT_MAX);

  // A converted expense is not complete until the converted figure has been
  // agreed to. Everything else about the form can be right while the number
  // that actually gets claimed is one nobody looked at.
  const conversionSettled =
    !foreignCurrency || (conversion.baseAmount !== null && confirmedBase === conversion.baseAmount);

  const formComplete =
    conversionSettled &&
    itemName.trim().length >= ITEM_MIN &&
    amountValue > 0 &&
    amountValue <= AMOUNT_MAX &&
    !!purchaseDate;

  async function onSubmit(e) {
    e.preventDefault();
    if (!formComplete) return;

    setSubmitting(true);
    setProgress(0);
    if (file) setReceiptStatus('uploading');

    const form = new FormData();
    form.append('itemName', itemName);
    // The parsed number, not the grouped text.
    form.append('amount', String(amountValue));
    form.append('currency', currency);
    if (manualRate) form.append('fxRate', manualRate);
    // Sent explicitly rather than relying on the server reading absent as 100.
    // No write about money should be ambiguous.
    form.append('businessUsePct', asksBusinessUse ? businessUsePct || '100' : '100');
    if (entityId) form.append('entityId', entityId);
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
        amount: amountValue,
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
        {/* Shown only once there is more than one set of books to choose
            between. Asking is more honest than hiding the form: "Everything" is
            a way of looking at records, not a place to put one. */}
        {showSwitcher && (
          <div>
            <label className="label">Which books</label>
            <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.kind === 'business' ? ' — Business' : ' — Individual'}
                </option>
              ))}
            </select>
            {isAll && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                You're viewing everything, so choose where this one belongs.
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">What did you buy?</label>
          <input
            className="input"
            required
            maxLength={ITEM_MAX}
            value={itemName}
            onChange={(e) => onItemNameChange(e.target.value)}
            placeholder="e.g. Safety Boots"
            aria-invalid={itemIssue ? 'true' : undefined}
            style={itemIssue ? { borderColor: 'var(--red)' } : undefined}
          />
          <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 4, color: 'var(--red)' }}>{itemIssue}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Amount</label>
            <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 11,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              >
                {currencySymbol(currency)}
              </span>
              <input
                className="input"
                required
                inputMode="decimal"
                maxLength={10}
                value={amount}
                onChange={(e) => setAmount(amountWhileTyping(e.target.value))}
                onBlur={() => setAmount(amountOnBlur(amount))}
                placeholder="0.00"
                aria-invalid={amountIssue ? 'true' : undefined}
                // One style prop. There were two, and JSX keeps the last —
                // so the padding that made room for the currency symbol was
                // discarded and the symbol sat against the first digit.
                style={{
                  flex: 1,
                  minWidth: 0,
                  paddingLeft: 28,
                  borderColor: amountIssue ? 'var(--red)' : undefined,
                }}
              />
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 90 }}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Only when it differs from the account's own currency. The rate
                used is the one for the purchase date, which is what a revenue
                office asks for — overridable with the rate the bank actually
                charged, which is more defensible still. */}
            {foreignCurrency && (
              <div
                style={{
                  marginTop: 8,
                  padding: 11,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <Icon name="globe" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  {conversion.loading ? (
                    <span style={{ color: 'var(--text-muted)' }}>Looking up the {currency} rate…</span>
                  ) : conversion.error ? (
                    <span style={{ color: 'var(--amber)' }}>{conversion.error}</span>
                  ) : conversion.baseAmount !== null ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span>
                        <strong>{formatMoney(conversion.baseAmount, baseCurrency)}</strong>{' '}
                        <span style={{ color: 'var(--text-muted)' }}>at {conversion.rate}</span>
                      </span>
                      {confirmedBase === conversion.baseAmount ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--emerald)', fontWeight: 700 }}>
                          <Icon name="check" size={13} />
                          Confirmed
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setConfirmedBase(conversion.baseAmount)}
                        >
                          Use this amount
                        </button>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Enter an amount to see the conversion</span>
                  )}
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Use my own rate</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={conversion.rate ? String(conversion.rate) : '0.0000'}
                    value={manualRate}
                    onChange={(e) => setManualRate(e.target.value.replace(/[^0-9.]/g, ''))}
                    onKeyDown={onDigitKeyDown}
                    style={{ width: 120, padding: '5px 9px', fontSize: 12.5 }}
                  />
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {currency} → {baseCurrency}
                  </span>
                </label>
              </div>
            )}
          </div>
          <div style={{ display: asksBusinessUse ? 'block' : 'none' }}>
            <label className="label">Business use</label>
            {/* Only asked of a business. Everything used to be all-or-nothing,
                so a 60%-business laptop had to be entered at 60% of its price —
                which threw away both the real amount and the audit trail. The
                receipt keeps its full value; only the claim is apportioned.
                Someone filing personal records is never asked at all. */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[100, 80, 50, 20].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setBusinessUsePct(String(pct))}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: '7px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: Number(businessUsePct) === pct ? '#fff' : 'var(--text-muted)',
                    background: Number(businessUsePct) === pct ? 'var(--accent)' : 'var(--bg-card)',
                    border: `1px solid ${Number(businessUsePct) === pct ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {pct}%
                </button>
              ))}
              <input
                className="input"
                inputMode="numeric"
                aria-label="Business use percentage"
                value={businessUsePct}
                onChange={(e) => setBusinessUsePct(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                onKeyDown={onDigitKeyDown}
                style={{ width: 70, padding: '6px 9px', fontSize: 12.5 }}
              />
            </div>
            {Number(businessUsePct) > 0 && Number(businessUsePct) < 100 && amountValue > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                Claiming <strong style={{ color: 'var(--text)' }}>{formatMoney((amountValue * Number(businessUsePct)) / 100, currency)}</strong>{' '}
                of {formatMoney(amountValue, currency)}
              </div>
            )}
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
              // This is the whole of it — the suggestion note below is gated on
              // !categoryTouched. A second setter here was never declared
              // anywhere, so picking a category by hand threw a ReferenceError.
              setCategoryTouched(true);
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
          <textarea
            className="input"
            rows={2}
            maxLength={NOTES_MAX}
            value={notes}
            onChange={(e) => setNotes(capitalizeSentences(e.target.value))}
            placeholder="Any extra detail for your records"
          />
          <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 4, color: 'var(--text-muted)' }}>
            {notes.length > NOTES_MAX - 100 ? `${NOTES_MAX - notes.length} characters left` : ''}
          </div>
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
