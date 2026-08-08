import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import Icon from '../components/Icon.jsx';
import { formatMoney } from '../lib/money.js';
import { IconPicker, ColourPicker, CategoryPreview, SWATCHES } from '../components/CategoryPickers.jsx';
import { defaultFinancialYear } from '../lib/financialYear.js';
import { useFinancialYears } from '../lib/useFinancialYears.js';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { useEntities } from '../lib/EntityContext.jsx';

import {
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  categoryNameError,
  isCategoryNameReady,
  tidyCategoryName,
} from '../lib/categoryName.js';


// Moving a category — with its expenses and every receipt attached to them —
// into a different set of books.
//
// Somebody files a category under their individual tax and later decides it
// belongs to a business. Before this the only way across was retyping every
// expense and re-uploading every receipt.
//
// The count is fetched before anything happens rather than guessed at, because
// "this will move 47 expenses and 31 receipts" is a different decision from
// "this will move some things", and the files really do move on disk.
function MoveCategory({ category, onMoved }) {
  const { entities, selectedId } = useEntities();
  const toast = useToast();
  const confirm = useConfirm();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  // Everywhere except where it already is. The page lists the categories of the
  // book currently open, so that book is the one to leave out — the row itself
  // does not carry its entity.
  const elsewhere = (entities || []).filter((e) => String(e.id) !== String(selectedId));
  if (elsewhere.length === 0) return null;

  async function move() {
    const to = elsewhere.find((e) => String(e.id) === String(target));
    if (!to) return;

    setBusy(true);
    try {
      const preview = await api.get(`/categories/${category.id}/move-preview?toEntityId=${to.id}`);
      const { expenses, receipts } = preview.data.summary;

      const ok = await confirm({
        title: `Move "${category.name}" to ${to.name}?`,
        body: (
          <>
            <div style={{ marginBottom: 8 }}>
              {expenses === 0
                ? 'Nothing has been filed under it yet, so only the category itself moves.'
                : `${expenses} ${expenses === 1 ? 'expense moves' : 'expenses move'} with it${
                    receipts > 0 ? `, and ${receipts} receipt${receipts === 1 ? '' : 's'} are moved on disk too` : ''
                  }.`}
            </div>
            <div>
              They will count towards {to.name} from then on, in its reports and its lodgement. You can move it back
              the same way.
            </div>
          </>
        ),
        confirmLabel: 'Move it',
      });
      if (!ok) return;

      const res = await api.post(`/categories/${category.id}/move`, { toEntityId: to.id });
      toast(
        res.data.moved.expenses > 0
          ? `Moved to ${to.name} with ${res.data.moved.expenses} expenses`
          : `Moved to ${to.name}`,
        'success'
      );
      onMoved?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
        Move to another set of books
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="input"
          value={target}
          disabled={busy}
          onChange={(e) => setTarget(e.target.value)}
          style={{ fontSize: 13, width: 'auto', minWidth: 170 }}
        >
          <option value="">Choose…</option>
          {elsewhere.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button className="btn btn-ghost" style={{ fontSize: 13 }} disabled={!target || busy} onClick={move}>
          {busy && <span className="spinner" />}
          Move
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
        Everything filed under it moves too — the expenses and their receipts.
      </div>
    </div>
  );
}

export default function Categories() {
  const { user } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [icon, setIcon] = useState('tag');
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('tag');
  const [editColor, setEditColor] = useState('');
  const [editRental, setEditRental] = useState(false);
  const [editBusy, setEditBusy] = useState(false);

  // Checked against the year being viewed, since that is the list a new
  // category would join — the same scope the unique key uses.
  const existingNames = (categories || []).map((c) => c.name);
  const nameError = categoryNameError(name, existingNames);
  const nameReady = isCategoryNameReady(name, existingNames);
  const editNameError = categoryNameError(editName, existingNames, categories?.find((c) => c.id === editingId)?.name);
  const editNameReady = isCategoryNameReady(editName, existingNames, categories?.find((c) => c.id === editingId)?.name);
  const [year, setYear] = useState(() => defaultFinancialYear(null, user?.financialYearRule));
  const [years, setYears] = useState([]);
  const { years: expenseYears } = useFinancialYears();
  // Which books these categories belong to — stated on the page now that the
  // books block has one of its own.
  const { entity: filingInto, showSwitcher } = useEntities();

  function load(forYear = year) {
    setCategories(null);
    api.get(`/categories?financialYear=${encodeURIComponent(forYear)}`).then((res) => {
      setCategories(res.data.categories);
      // The server includes the year being viewed even when it had none of its
      // own a moment ago, so the picker never loses the year you're on.
      setYears(Array.from(new Set([...(res.data.years || []), forYear])).sort().reverse());
    });
  }

  useEffect(() => {
    load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function onAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/categories', { name, color, icon, financialYear: year });
      setName('');
      setIcon('tag');
      setAdding(false);
      toast('Category added', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditColor(c.color);
    setEditIcon(c.icon || 'tag');
    setEditRental(!!c.isPropertyRental);
    setConfirmingId(null);
  }

  async function saveEdit(id) {
    if (!editName.trim()) return;
    setEditBusy(true);
    try {
      await api.patch(`/categories/${id}`, {
        name: editName,
        color: editColor,
        icon: editIcon,
        isPropertyRental: editRental,
      });
      toast('Category updated', 'success');
      setEditingId(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setEditBusy(false);
    }
  }

  async function confirmDelete(id) {
    try {
      await api.delete(`/categories/${id}`);
      setConfirmingId(null);
      setConfirmText('');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Years with categories and years with expenses are both real; the union is
  // what someone can meaningfully switch between.
  const selectableYears = Array.from(new Set([...years, ...expenseYears, year])).sort().reverse();

  const totalTracked = (categories || []).reduce((sum, c) => sum + c.totalAmount, 0);

  return (
    <div style={{ maxWidth: 940 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Categories</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {categories === null
              ? 'Loading…'
              : `${categories.length} categories in FY ${year} · ${formatMoney(totalTracked)} tracked`}
          </p>
        </div>
        {/* Categories belong to a financial year: how you filed things in
            2024-2025 shouldn't change because you renamed something today.
            A year you haven't used yet opens with last year's set. */}
        <select
          className="input"
          aria-label="Financial year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{ width: 148, padding: '9px 10px', fontSize: 13 }}
        >
          {/* Years this account actually has — either expenses or a set of
              categories already carried into it — plus the current one. A
              year nobody has used is a choice with no meaning. */}
          {selectableYears.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setAdding((v) => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
        >
          <Icon name={adding ? 'x' : 'plus'} size={15} />
          {adding ? 'Cancel' : 'New category'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {adding && (
          <motion.form
            onSubmit={onAdd}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: 22 }}
          >
            <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <CategoryPreview icon={icon} color={color} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="label">Name</label>
                  <input
                    className="input"
                    autoFocus
                    placeholder="e.g. Software Subscriptions"
                    maxLength={MAX_NAME_LENGTH}
                    value={name}
                    onChange={(e) => setName(tidyCategoryName(e.target.value))}
                    aria-invalid={nameError ? 'true' : undefined}
                    style={nameError ? { borderColor: 'var(--red)' } : undefined}
                  />
                  {/* Said as it is typed. Finding out a name is taken by
                      pressing the button and being refused is the same
                      information arriving too late to be useful. */}
                  <div
                    style={{
                      fontSize: 11.5,
                      marginTop: 5,
                      minHeight: 15,
                      color: nameError ? 'var(--red)' : 'var(--text-muted)',
                    }}
                  >
                    {nameError || `${MIN_NAME_LENGTH}–${MAX_NAME_LENGTH} characters`}
                  </div>
                </div>
                <ColourPicker value={color} onChange={setColor} />
              </div>

              <IconPicker value={icon} onChange={setIcon} />

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="btn btn-primary" disabled={busy || !nameReady} type="submit">
                  {busy && <span className="spinner" />}
                  Add to FY {year}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Categories belong to one set of books, so which one has to be on the
          screen. It used to be implied by the books block that sat above the
          title; with that on its own page, it gets said. */}
      {filingInto && showSwitcher && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 16,
            padding: '9px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-inset)',
            fontSize: 12.5,
            color: 'var(--text-muted)',
          }}
        >
          <Icon name={filingInto.kind === 'business' ? 'briefcase' : 'user'} size={14} />
          <span>
            Categories for <strong style={{ color: 'var(--text)' }}>{filingInto.name}</strong>
          </span>
          <Link to="/books" style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 600 }}>
            Your books
          </Link>
        </div>
      )}

      {categories === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}>
          <AnimatePresence initial={false}>
            {categories.map((c) => {
              const editing = editingId === c.id;
              const confirming = confirmingId === c.id;
              return (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="card"
                  style={{
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    // A rental card carries a document panel, so it takes the
                    // full row rather than being squeezed into one column.
                    gridColumn: c.isPropertyRental || editing ? '1 / -1' : 'auto',
                    borderLeft: `4px solid ${c.color}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 13,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: `${editing ? editColor : c.color}1f`,
                        border: `1px solid ${editing ? editColor : c.color}55`,
                        color: editing ? editColor : c.color,
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={editing ? editIcon : c.icon} size={26} />
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      {editing ? (
                        <>
                          <input
                            className="input"
                            autoFocus
                            maxLength={MAX_NAME_LENGTH}
                            value={editName}
                            onChange={(e) => setEditName(tidyCategoryName(e.target.value))}
                            aria-invalid={editNameError ? 'true' : undefined}
                            style={editNameError ? { borderColor: 'var(--red)' } : undefined}
                          />
                          {editNameError && (
                            <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--red)' }}>{editNameError}</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 15,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {c.name}
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                            {c.expenseCount === 0
                              ? 'No expenses yet'
                              : `${c.expenseCount} ${c.expenseCount === 1 ? 'expense' : 'expenses'} · ${formatMoney(
                                  c.totalAmount
                                )}`}
                          </div>
                        </>
                      )}
                    </div>

                    {!editing && !confirming && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 12.5, padding: '7px 12px', gap: 6 }}
                          onClick={() => startEdit(c)}
                        >
                          <Icon name="pencil" size={14} />
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost icon-btn"
                          title={`Delete ${c.name}`}
                          aria-label={`Delete ${c.name}`}
                          onClick={() => {
                            setConfirmingId(c.id);
                            setConfirmText('');
                          }}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    )}
                  </div>

                  {!editing && c.isPropertyRental && (
                    <span
                      title="Property rental — keeps its own documents"
                      style={{
                        alignSelf: 'flex-start',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '3px 9px',
                        borderRadius: 999,
                        color: 'var(--accent)',
                        background: 'var(--accent-soft)',
                        border: '1px solid var(--accent-ring)',
                      }}
                    >
                      <Icon name="home" size={12} />
                      Rental
                      {c.documentCount > 0 && <span style={{ fontWeight: 600 }}>· {c.documentCount} documents</span>}
                    </span>
                  )}

                  {confirming && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        className="input"
                        autoFocus
                        placeholder='Type "delete"'
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        style={{ width: 140, padding: '7px 10px', fontSize: 12.5 }}
                      />
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 12.5, padding: '7px 13px', background: 'var(--red)' }}
                        disabled={confirmText.trim().toLowerCase() !== 'delete'}
                        onClick={() => confirmDelete(c.id)}
                      >
                        Delete
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12.5, padding: '7px 13px' }}
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {editing && (
                    <>
                      <ColourPicker value={editColor} onChange={setEditColor} />
                      <IconPicker value={editIcon} onChange={setEditIcon} />
                      <label
                        title="Property rentals collect paperwork of their own — statements, schedules, end-of-year summaries."
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12.5,
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <input type="checkbox" checked={editRental} onChange={(e) => setEditRental(e.target.checked)} />
                        This is a property rental
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 13 }}
                          disabled={editBusy || !editNameReady}
                          onClick={() => saveEdit(c.id)}
                        >
                          {editBusy && <span className="spinner" />}
                          Save
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>

                      <MoveCategory category={c} onMoved={load} />
                    </>
                  )}

                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
