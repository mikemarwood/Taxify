import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { useLockBodyScroll } from '../lib/useLockBodyScroll.js';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import CategoryBadge from './CategoryBadge.jsx';
import ReceiptDropzone from './ReceiptDropzone.jsx';
import Toggle from './Toggle.jsx';
import ReceiptLightbox from './ReceiptLightbox.jsx';
import ReceiptPreview from './ReceiptPreview.jsx';
import Icon from './Icon.jsx';
import { formatAmount, formatMoney, parseAmount, amountWhileTyping, amountOnBlur, currencySymbol } from '../lib/money.js';
import { currenciesFor } from '../lib/currencies.js';
import { onDigitKeyDown, playOpen, playClose } from '../lib/sounds.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import { financialYearOf } from '../lib/financialYear.js';
import { formatDateShort, formatDateLong, todayIso } from '../lib/dates.js';


function capitalizeWords(str) {
  return str.replace(/(^|\s)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

function capitalizeSentences(str) {
  return str.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// Receipts are filed under <uploads>/<user>/<financial-year>/<category>, so
// the directory is both a way to find the file outside the app and a check
// that the expense is categorised the way you meant.
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
  // The page behind must not move while this is over it.
  useLockBodyScroll(open);
  const { user } = useAuth();
  // actingAsClient matters as much as the role. Somebody who came in through
  // an invitation while already having their own account is role 'owner', so
  // this showed them edit and delete controls inside a client's books that the
  // server refuses — a lie about somebody else's records.
  const readOnly = Boolean(user?.readOnly || user?.actingAsClient || user?.role === 'accountant');
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Stopping a repeat is not editing an expense. Nothing about this purchase
  // changes — only whether another one is written next month — so it asks its
  // own question and saves nothing else.
  async function stopRecurring() {
    const ok = await confirm({
      title: `Stop repeating ${expense.itemName}?`,
      body: 'No more copies will be added. Everything it has already added stays exactly where it is, and this expense is not changed.',
      confirmLabel: 'Stop repeating',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    setStopping(true);
    try {
      await api.post(`/expenses/${expense.id}/stop-recurring`);
      toast('It will not repeat again', 'success');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
      setStopping(false);
    }
  }
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // The panel opens at its own top, and goes back there on Edit.
  //
  // It scrolls inside itself, and a scroll position survives the switch from
  // reading an expense to editing it — so pressing Edit on a long one left the
  // form opened somewhere down its middle, with the heading and the amount
  // above the fold. Keyed on `editing` as well as the expense, because that
  // switch replaces the whole contents of the same scrolling box.
  const panel = useRef(null);
  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [editing, expense.id]);

  const [itemName, setItemName] = useState(expense.itemName);
  const [amount, setAmount] = useState(String(expense.amount));
  // The expense's own currency, or the account's — never a hardcoded AUD,
  // which was somebody in Canada opening a new expense already set to the
  // wrong money.
  const [currency, setCurrency] = useState(expense.currency || user?.currency || 'AUD');
  const [purchaseDate, setPurchaseDate] = useState(expense.purchaseDate.slice(0, 10));
  const [categoryId, setCategoryId] = useState(expense.category ? String(expense.category.id) : '');
  const [isRecurring, setIsRecurring] = useState(!!expense.isRecurring);
  const [frequency, setFrequency] = useState(expense.frequency || 'monthly');
  const [notes, setNotes] = useState(expense.notes || '');
  // Seeded from the expense, because this field not being here at all is what
  // made every edit of a part-business expense quietly reset it to a full
  // claim: the save sent no percentage, and the server reads "absent" as 100.
  const [businessUsePct, setBusinessUsePct] = useState(String(expense.businessUsePct ?? 100));
  const { entities, showSwitcher } = useEntities();
  const [entityId, setEntityId] = useState(expense.entity ? String(expense.entity.id) : '');
  const filingInto = entities.find((e) => String(e.id) === String(entityId)) || expense.entity || null;
  // Only a business is asked. An individual's records are always claimed whole.
  const asksBusinessUse = filingInto?.kind === 'business';
  const [file, setFile] = useState(null);
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

  // Categories belong to a financial year, so the list follows the date being
  // edited — moving an expense into another year offers that year's set.
  const categoryYear = financialYearOf(purchaseDate, user?.financialYearRule);

  useEffect(() => {
    if (!editing) return;
    api.get(`/categories?financialYear=${encodeURIComponent(categoryYear)}`).then((res) => {
      const next = res.data.categories;
      setCategoryId((current) => {
        // Carried across by name, so changing the date doesn't quietly refile
        // the expense under whatever happens to be first in the new year.
        const previous = categories.find((c) => String(c.id) === String(current));
        const match = previous && next.find((c) => c.name === previous.name);
        if (match) return String(match.id);
        const byName = expense.category && next.find((c) => c.name === expense.category.name);
        if (byName) return String(byName.id);
        return next[0] ? String(next[0].id) : '';
      });
      setCategories(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, categoryYear]);

  function onFileChange(next) {
    setFile(next);
    setRemoveReceipt(false);
    setReceiptStatus('idle');
    setReceiptError('');
  }

  // The number behind the grouped text in the field.
  const amountValue = parseAmount(amount) ?? 0;
  const formComplete = itemName.trim().length > 0 && amountValue > 0 && !!purchaseDate;

  async function onSave(e) {
    e.preventDefault();
    if (!formComplete) return;

    setBusy(true);
    setProgress(0);
    if (file) setReceiptStatus('uploading');

    const form = new FormData();
    form.append('itemName', itemName);
    // The parsed number, not the grouped text. '3,350.00' reaches the server
    // as a string it cannot read as an amount.
    form.append('amount', String(amountValue));
    form.append('currency', currency);
    form.append('purchaseDate', purchaseDate);
    form.append('categoryId', categoryId);
    form.append('isRecurring', isRecurring);
    form.append('frequency', isRecurring ? frequency : '');
    form.append('notes', notes);
    form.append('businessUsePct', asksBusinessUse ? businessUsePct || '100' : '100');
    if (entityId) form.append('entityId', entityId);
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
      // Always. The receipt is evidence for the claim; with the claim gone it
      // is a file in the books attached to nothing. The server still declines
      // to unlink one that another expense is using.
      const res = await api.delete(`/expenses/${expense.id}`, {
        params: { deleteReceipt: 'true' },
      });
      toast(res.data?.receiptDeleted ? 'Expense and receipt deleted' : 'Expense deleted', 'success');
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
          ref={panel}
          style={{
            width: '100%',
            maxWidth: 480,
            // Sized to its content. It was 90vh with overflow-y: auto, which is
            // nearly right — but a full-height receipt preview inside pushed
            // almost every expense past the limit, so the panel scrolled even
            // when there was little in it. The preview is capped below.
            // The overlay already keeps 20px clear on each side, so this can
            // use what is left rather than a flat 90vh that gave away another
            // 60px on a laptop for no reason.
            maxHeight: 'calc(100vh - 40px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            padding: 28,
            position: 'relative',
          }}
        >
          {/* Escape and a click outside both already close this. The cross is
              the one people look for, and on a phone there is no Escape key and
              little outside to click. */}
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="btn btn-ghost"
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 2,
              padding: 7,
              lineHeight: 0,
              borderRadius: 999,
              color: 'var(--text-muted)',
            }}
          >
            <Icon name="x" size={17} />
          </button>

          {editing ? (
            <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20, paddingRight: 34 }}>Edit expense</h2>
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
                  <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
                    {/* The symbol inside the field, so a grouped number is
                        unambiguous about what it counts. Positioned rather
                        than a sibling, so it is never selected or copied
                        along with the value. */}
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
                      maxLength={14}
                      value={amount}
                      onChange={(e) => setAmount(amountWhileTyping(e.target.value))}
                      onBlur={() => setAmount(amountOnBlur(amount))}
                      // One style prop, not two.
                      //
                      // There were two, and JSX keeps the last — so the
                      // paddingLeft that makes room for the currency symbol was
                      // thrown away and the "$" sat against the first digit.
                      // Nothing warns about a duplicate prop; the later one
                      // simply wins.
                      // Room for whatever the prefix actually is.
                      //
                      // currencySymbol returns the three-letter code for every
                      // currency except the account's own, so a flat 28px was
                      // right for "$" and left "USD" sitting on top of the
                      // first digit.
                      style={{ flex: 1, minWidth: 0, paddingLeft: 14 + currencySymbol(currency).length * 9 }}
                    />
                    <select
                      className="input"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      style={{ width: 104, flexShrink: 0 }}
                    >
                      {currenciesFor(user?.currency).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Date</label>
                  {/* No date after today. Add expense has capped this since it
                      was written and editing one never did, so the same value
                      could be typed here that the other form refuses — and the
                      typo it catches is the expensive kind: a 2027 keyed for
                      2026 files the expense into a tax year that has not
                      happened, where it vanishes from this year's total.

                      todayIso() rather than toISOString(), which converts to
                      UTC first and would refuse today until mid-morning in
                      Australia. */}
                  <input
                    className="input"
                    required
                    type="date"
                    max={todayIso()}
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </div>
              </div>
              {showSwitcher && (
                <div>
                  <label className="label">Which books</label>
                  <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {/* Capitalised, and both kinds named. Add expense
                            already says "— Business" / "— Individual"; this
                            said "— business" for one kind and nothing for the
                            other, so the same list read differently depending
                            on which screen you opened it from. */}
                        {e.kind === 'business' ? ' — Business' : ' — Individual'}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    Moving this to another set of books takes its receipt with it.
                  </div>
                </div>
              )}

              <div style={{ display: asksBusinessUse ? 'block' : 'none' }}>
                <label className="label">Business use</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[100, 80, 50, 20].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className={Number(businessUsePct) === pct ? 'btn btn-primary' : 'btn btn-ghost'}
                      style={{ padding: '6px 12px', fontSize: 12.5 }}
                      onClick={() => setBusinessUsePct(String(pct))}
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
                    style={{ width: 74 }}
                  />
                </div>
                {/* The same readout as Add expense, and shown at 100% for the
                    same reason: the press most likely to be made first
                    produced no visible answer, so the control read as
                    inert. The amount above stays what was actually paid —
                    only the claim is apportioned. */}
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
                      background:
                        Number(businessUsePct) < 100 ? 'rgba(12, 115, 67, 0.08)' : 'var(--bg-inset)',
                      fontSize: 12.5,
                    }}
                  >
                    <Icon
                      name="cash"
                      size={14}
                      style={{
                        color:
                          Number(businessUsePct) < 100 ? 'var(--emerald)' : 'var(--text-subtle)',
                        flexShrink: 0,
                      }}
                    />
                    <span>
                      Claiming{' '}
                      <strong
                        style={{
                          color:
                            Number(businessUsePct) < 100 ? 'var(--emerald)' : 'var(--text)',
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
                <label className="label">Category</label>
                {/* No Uncategorised to choose.
                    Filing an expense under nothing is not a decision anybody
                    makes on purpose while editing one — the category is what
                    puts the amount into a total and onto a report, so picking
                    it off is only ever a way to lose the claim. The blank
                    option is still rendered when the expense arrived without a
                    category, because the select has to show something; it is
                    disabled, so it can be left but not returned to. */}
                <select className="input" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {!categoryId && (
                    <option value="" disabled>
                      Choose a category
                    </option>
                  )}
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
                {expense.receiptUrl && !file && !removeReceipt ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }} onClick={() => setLightboxOpen(true)}>
                      <Icon name="receipt" size={15} />
                      View current receipt
                    </button>
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
                  <h2 style={{ margin: 0, fontSize: 21, lineHeight: 1.3, wordBreak: 'break-word', paddingRight: 8 }}>{expense.itemName}</h2>
                  <div style={{ marginTop: 10 }}>
                    <CategoryBadge category={expense.category} />
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, whiteSpace: 'nowrap' }}>{formatAmount(expense.amount)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{expense.currency || 'AUD'}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 16, columnGap: 16 }}>
                <DetailRow
                  label="Purchase date"
                  value={formatDateLong(expense.purchaseDate)}
                />
                {/* One sequence across expenses, trips and hours, so quoting
                    a number in a support ticket names exactly one thing. */}
                {expense.entryNo && <DetailRow label="Entry" value={`#${expense.entryNo}`} />}
                <DetailRow label="Category" value={expense.category?.name || 'Uncategorised'} />
                <DetailRow
                  label="Recurring"
                  value={
                    expense.isRecurring ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span>Yes · {expense.frequency}</span>
                        {/* Beside the fact it undoes, rather than four steps
                            away in the edit form. Stopping a repeat is not
                            editing an expense — nothing about this purchase
                            changes, only whether another one is written next
                            month. */}
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 11.5, padding: '4px 10px' }}
                          disabled={stopping}
                          onClick={stopRecurring}
                        >
                          {stopping && <span className="spinner" />}
                          Stop repeating
                        </button>
                      </span>
                    ) : (
                      'No'
                    )
                  }
                />
                {expense.autoGenerated && <DetailRow label="Added automatically" value="Yes" />}
                {expense.createdAt && (
                  <DetailRow
                    label="Added on"
                    value={formatDateShort(expense.createdAt)}
                  />
                )}
                {expense.createdByName && <DetailRow label="Added by" value={expense.createdByName} />}
                {/* Only shown once it's actually been edited — "last edited by"
                    on a record nobody has touched is noise. */}
                {expense.updatedByName && expense.updatedAt && (
                  <DetailRow
                    label="Last edited by"
                    value={`${expense.updatedByName} · ${formatDateShort(expense.updatedAt)}`}
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
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No receipt attached</span>
                )}
              </div>

              {confirmingDelete ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Delete this expense? It will be removed from your records and from every report and total.
                  </span>

                  {/* Nothing here about the receipt.

                      It was a checkbox, then a panel explaining what the
                      checkbox used to decide, and both were answering a
                      question nobody asked. The receipt is evidence for the
                      claim: once the claim is gone the file is a document in
                      the books attached to nothing, so it goes too, and that
                      is what anybody would assume. Spelling out the filename
                      and the consequences turned a one-line confirmation into
                      a paragraph of small print about a decision that is not
                      theirs to make. The line above already says the expense
                      is removed from their records. */}

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-primary" style={{ background: 'var(--red)', fontSize: 13, flex: 1 }} disabled={busy} onClick={onDelete}>
                      {busy && <span className="spinner" />}
                      Delete expense
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
