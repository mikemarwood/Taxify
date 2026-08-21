import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import ReceiptDropzone from '../components/ReceiptDropzone.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';
import Toggle from '../components/Toggle.jsx';
import Icon from '../components/Icon.jsx';
import { financialYearOf } from '../lib/financialYear.js';
import { todayIso } from '../lib/dates.js';
import { earliestOpenDate, dateIsClosed } from '../lib/openDates.js';
import { useEntities } from '../lib/EntityContext.jsx';
import { onDigitKeyDown, playSuccess } from '../lib/sounds.js';
import { formatMoney, amountWhileTyping, amountOnBlur, parseAmount, currencySymbol } from '../lib/money.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { TripForm, HoursForm } from '../components/DeductionForms.jsx';
import LodgedConfirmation from '../components/LodgedConfirmation.jsx';

// The three things this page can add. A receipt is the common one and stays
// the default; the other two are the deductions that have no receipt to
// attach, which is the only reason they were ever a separate page.
const KINDS = [
  { id: 'receipt', tab: 'Receipt', icon: 'receipt', heading: 'Add expense', blurb: 'Log a purchase and attach the receipt.' },
  { id: 'trip', tab: 'Vehicle trip', icon: 'car', heading: 'Add a trip', blurb: 'Odometer at the start and the finish — the distance works itself out.' },
  { id: 'hours', tab: 'Home office', icon: 'home', heading: 'Add hours worked', blurb: 'Hours worked from home, logged the day you work them.' },
];

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

  // Which of the three is on screen. Receipt by default, because it is what
  // most days produce.
  const [kind, setKind] = useState('receipt');

  const [categories, setCategories] = useState([]);
  const [finalisedYears, setFinalisedYears] = useState([]);
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

  // Re-read when the books change, not only when the year does.
  //
  // Categories belong to a set of books, and this asked only about the year —
  // so switching books on the form left the previous book's categories in the
  // list, and filing an expense into one book under a category belonging to
  // another. The entity is sent as well as watched, because the server
  // otherwise answers about whichever books the sidebar has selected rather
  // than the ones this form is filing into.
  useEffect(() => {
    const scope = entityId ? `&entityId=${encodeURIComponent(entityId)}` : '';
    api.get(`/categories?financialYear=${encodeURIComponent(categoryYear)}${scope}`).then((res) => {
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
      // Which years of these books are shut, so the date picker can stay out
      // of them rather than offering a day the server will refuse.
      setFinalisedYears(res.data.finalisedYears || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryYear, entityId]);

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

  // What is still missing, in the order somebody filled the form in.
  //
  // The button was disabled with nothing said, which from the other side of the
  // screen is a button that does nothing when pressed. Every one of these was
  // already a condition of submitting — they were simply never mentioned, so
  // whichever one you had not met was invisible.
  const dateClosed = dateIsClosed(purchaseDate, finalisedYears, user?.financialYearRule);

  const missing = [];
  if (itemName.trim().length < ITEM_MIN) missing.push('what you bought');
  if (!(amountValue > 0 && amountValue <= AMOUNT_MAX)) missing.push('an amount');
  // Business use, which is a question only a business is asked — and the one
  // gate here that could be failed without any sign of it. Typing 0 left the
  // button live and the server refused with "Business use must be between 1 and
  // 100 percent", so pressing submit produced a toast about a field halfway up
  // the form, or nothing at all if it was missed.
  if (asksBusinessUse) {
    const pct = Number(businessUsePct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) missing.push('a business use between 1 and 100%');
  }
  // Which books, when there is a choice and nothing has been chosen. The server
  // refuses this one too, and its refusal is about "books" while the form calls
  // them something else on the label above.
  if (!entityId) missing.push('which books this belongs to');
  if (!purchaseDate) missing.push('a date');
  if (dateClosed) missing.push('a date in a year that is still open');
  if (!conversionSettled) missing.push('the converted amount confirmed');

  const formComplete = missing.length === 0;

  // Back to an empty form, properly.
  //
  // "Add another" only cleared the confirmation. submitted stayed true from the
  // save before it, and the button reads disabled={submitting || submitted ||
  // …} — so the form came back with Save expense dead, for ever, and pressing
  // it did nothing at all. Which is exactly what a disabled button does.
  //
  // The fields are cleared with it. Leaving the last expense in the boxes
  // invites somebody to change one figure and save what looks like a new entry
  // but carries the old date, the old category and the old receipt.
  function startAnother() {
    setSaved(null);
    setSubmitted(false);
    setSubmitting(false);
    setItemName('');
    setAmount('');
    setNotes('');
    setFile(null);
    setReceiptStatus('idle');
    setReceiptError('');
    setProgress(0);
    setIsRecurring(false);
    setConfirmedBase(null);
    setCategoryTouched(false);
    // The date, the books, the currency and the business-use split are left
    // alone: somebody entering a run of receipts is almost always entering them
    // for the same day, the same books and the same business, and retyping that
    // each time is the actual work.
  }

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
        detail: `${itemName.trim()} — ${formatMoney(amountValue)}. ${
          file ? 'Receipt attached and filed.' : 'No receipt attached.'
        }`,
        againLabel: 'Add another expense',
      });
      setSubmitted(true);
      playSuccess();
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

  const chosen = KINDS.find((k) => k.id === kind);

  return (
    <div style={{ maxWidth: kind === 'receipt' ? 560 : 940 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>{chosen.heading}</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 20px' }}>{chosen.blurb}</p>

      {/* Three things get claimed, and only one of them comes with a receipt.
          Kilometres and hours used to live on a page of their own, so logging a
          day's work meant knowing which of two screens each part of it belonged
          on — a distinction about our tables, not about anybody's day.

          Gone while the confirmation is up. That screen is about the thing
          just lodged and what to do next; a row of tabs above it offers a
          fourth answer to a question nobody asked, and switching tab there
          would clear the confirmation without saying so. */}
      {!saved && (
      <div className="add-kind" role="tablist" aria-label="What are you adding">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={kind === k.id}
            onClick={() => setKind(k.id)}
            className={kind === k.id ? 'add-kind-btn is-on' : 'add-kind-btn'}
          >
            <Icon name={k.icon} size={15} />
            {k.tab}
          </button>
        ))}
      </div>
      )}

      {/* The form stands down while the confirmation is up, the same way the
          receipt form does. Two things on screen — one saying it is done and
          one still asking — is how somebody ends up entering it twice. */}
      {kind !== 'receipt' && !saved && (
        <div className="card" style={{ padding: 24 }}>
          {showSwitcher && (
            <div style={{ marginBottom: 18, maxWidth: 320 }}>
              <label className="label">Which books</label>
              <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.kind === 'business' ? ' — Business' : ' — Individual'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* No year is passed, so the date is bounded by today and nothing
              else: the server files an entry into whatever year it falls in,
              and this page is not showing one. */}
          {kind === 'trip' ? (
            <TripForm entityId={entityId} onAdded={(what) => setSaved(what)} />
          ) : (
            <HoursForm entityId={entityId} onAdded={(what) => setSaved(what)} />
          )}

        </div>
      )}

      {/* Kept mounted rather than unmounted, so switching away and back does
          not throw away a half-filled receipt — including an upload that has
          already been chosen. */}
      <form
        onSubmit={onSubmit}
        className="card"
        style={{ padding: 24, display: kind === 'receipt' && !saved ? 'flex' : 'none', flexDirection: 'column', gap: 18 }}
      >
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

        {/* Amount and date, side by side where there is room and stacked
            where there is not. A hard two-column grid gave each of them
            half of a 360px phone, so the currency symbol, the figure and
            the date all fought for about 150 pixels. */}
        <div className="add-pair">
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
            {/* What is being claimed, kept on screen while the percentage is
                being chosen.

                It already changed with every press — it was 12px grey text
                under the buttons, and it disappeared entirely at 100%, so the
                one press most likely to be made first produced no visible
                answer at all and the whole thing read as inert. Shown from the
                moment there is an amount, at 100% as well, so pressing 80 and
                watching a figure move is how somebody learns what this control
                does.

                The amount above is deliberately untouched. The receipt is for
                what was actually paid; only the claim is apportioned, and
                rewriting the price to 60% of itself would throw away both the
                real figure and the reason for it. */}
            {amountValue > 0 && Number(businessUsePct) > 0 && (
              <div
                aria-live="polite"
                style={{
                  marginTop: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '5px 11px',
                  borderRadius: 8,
                  border: `1px solid ${Number(businessUsePct) < 100 ? 'var(--emerald)' : 'var(--border)'}`,
                  background: Number(businessUsePct) < 100 ? 'rgba(12, 115, 67, 0.08)' : 'var(--bg-inset)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                <Icon
                  name="cash"
                  size={14}
                  style={{ color: Number(businessUsePct) < 100 ? 'var(--emerald)' : 'var(--text-subtle)', flexShrink: 0 }}
                />
                <span>
                  Claiming{' '}
                  <strong
                    style={{
                      color: Number(businessUsePct) < 100 ? 'var(--emerald)' : 'var(--text)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatMoney((amountValue * Number(businessUsePct)) / 100, currency)}
                  </strong>
                  {Number(businessUsePct) < 100 ? (
                    <span style={{ color: 'var(--text-muted)' }}> of {formatMoney(amountValue, currency)}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}> — the whole amount</span>
                  )}
                </span>
              </div>
            )}
          </div>
          <div>
            <label className="label">Date</label>
            {/* Nothing in the future. A receipt for something that has not been
                bought yet is a typo, and it files itself into a year that has
                not started. */}
            {/* Not into a year that has been finalised. The picker's floor is
                the day after the last closed year ends; dateIsClosed catches a
                closed year with an open one after it, which min cannot say. */}
            <input
              className="input"
              required
              type="date"
              min={earliestOpenDate(finalisedYears, user?.financialYearRule)}
              max={todayIso()}
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
            {/* Which year it lands in, said before it is saved.
                A date can be any date — last July is an ordinary thing to enter
                in September — and the year it belongs to follows from it rather
                than from anything on this form. Somebody entering an old
                receipt should be able to see it going to the right place
                instead of finding out on the reports page. */}
            <div
              style={{
                fontSize: 11.5,
                marginTop: 5,
                lineHeight: 1.5,
                color: dateClosed ? 'var(--red)' : 'var(--text-muted)',
              }}
            >
              {dateClosed
                ? `FY ${categoryYear} has been finalised — reopen it from Reports to add to it.`
                : categoryYear
                ? `Filed into FY ${categoryYear}`
                : 'Choose a date to file this against a year'}
            </div>
          </div>
        </div>

        <div>
          {/* Optional, and now labelled so. The server has always accepted an
              expense without one and files it as Uncategorised; the form simply
              never said, so a required-looking dropdown sat between somebody
              and a receipt they wanted to file. It can be set later from the
              expense itself, which is often when it is actually known. */}
          <label className="label">
            Category
          </label>

          {/* One category is not a choice.

              A dropdown with a single entry asks somebody to open it, look at
              the one thing inside, and pick the thing that was already picked.
              It is shown as what it is instead — the category this will be
              filed under — and the select comes back the moment there are two
              to choose between. */}
          {categories.length === 1 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg-inset)',
                fontSize: 14,
              }}
            >
              <Icon name={categories[0].icon || 'tag'} size={16} style={{ color: categories[0].color }} />
              <span style={{ fontWeight: 600 }}>{categories[0].name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
                the only category in these books
              </span>
            </div>
          ) : (
            <select
              className="input"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                // This is the whole of it — the suggestion note below is gated
                // on !categoryTouched. A second setter here was never declared
                // anywhere, so picking a category by hand threw a
                // ReferenceError.
                setCategoryTouched(true);
              }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
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
          {/* The word optional belongs to the label, in the same grey as every
              other hint on this form, rather than in brackets as though it
              were part of the field's name. */}
          <label className="label">
            Receipt <span style={{ fontWeight: 500, color: 'var(--text-subtle)' }}>— optional</span>
          </label>
          <ReceiptDropzone
            file={file}
            onFileChange={onFileChange}
            uploadProgress={progress}
            status={receiptStatus}
            errorMessage={receiptError}
          />
        </div>

        {/* Why it will not go, rather than a grey button and no explanation. */}
        {!formComplete && !submitting && !submitted && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.55 }}>
            Still needed: {missing.join(', ')}.
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={submitting || submitted || !formComplete} style={{ marginTop: 4 }}>
          {submitting && !submitted && <span className="spinner" />}
          {submitted ? 'Saved' : submitting ? 'Saving…' : 'Save expense'}
        </button>
      </form>

      {/* One confirmation for all three things this page can add.

          A receipt used to get a card with a tick and a silent two-second jump
          to the dashboard; a trip got a line of green text and left you on the
          form wondering whether to press it again. Same act, three answers. */}
      <AnimatePresence>
        {saved && (
          <div style={{ marginTop: 18 }}>
            <LodgedConfirmation
              title="Expense lodged"
              detail={saved.detail}
              reference={saved.id ? String(saved.id).padStart(5, '0') : null}
              onDone={() => navigate('/')}
              onAgain={startAnother}
              againLabel={saved.againLabel || 'Add another'}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
