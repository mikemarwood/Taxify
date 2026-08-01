import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import { ICON_OPTIONS } from '../lib/categoryIcons.js';
import Icon from '../components/Icon.jsx';
import CategoryDocuments from '../components/CategoryDocuments.jsx';
import { formatMoney } from '../lib/money.js';

const SWATCHES = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#ef4444', '#eab308', '#14b8a6', '#a1a1aa'];

const MAX_NAME_LENGTH = 40;

// The icon is the thing you actually scan for in a list of categories, so it
// is drawn at a size you can recognise across the page rather than at label
// size. The picker shows them the same way, because picking a 15px glyph out
// of a grid of 15px glyphs is guesswork.
function IconPicker({ value, onChange }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        Icon
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))', gap: 6 }}>
        {ICON_OPTIONS.map((icon) => {
          const selected = value === icon;
          return (
            <button
              type="button"
              key={icon}
              onClick={() => onChange(icon)}
              title={icon.replace(/-/g, ' ')}
              style={{
                height: 46,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                color: selected ? 'var(--accent)' : 'var(--text-muted)',
                background: selected ? 'var(--accent-soft)' : 'var(--bg-inset)',
                border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <Icon name={icon} size={22} strokeWidth={selected ? 2 : 1.7} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColourPicker({ value, onChange, label = 'Colour' }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SWATCHES.map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => onChange(s)}
            aria-label={s}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: s,
              border: value === s ? '3px solid var(--bg-elevated)' : '3px solid transparent',
              boxShadow: value === s ? `0 0 0 2px ${s}` : 'none',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function Categories() {
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

  function load() {
    api.get('/categories').then((res) => setCategories(res.data.categories));
  }

  useEffect(load, []);

  async function onAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/categories', { name, color, icon });
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

  const totalTracked = (categories || []).reduce((sum, c) => sum + c.totalAmount, 0);

  return (
    <div style={{ maxWidth: 940 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Categories</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {categories === null
              ? 'Everyone starts with the same defaults — add your own on top.'
              : `${categories.length} categories · ${formatMoney(totalTracked)} tracked`}
          </p>
        </div>
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
                {/* A live preview of the tile being described, so the icon and
                    colour are chosen against the thing they'll appear on. */}
                <div
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${color}1f`,
                    border: `1px solid ${color}55`,
                    color,
                    flexShrink: 0,
                  }}
                >
                  <Icon name={icon} size={28} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="label">Name</label>
                  <input
                    className="input"
                    autoFocus
                    placeholder="e.g. Software subscriptions"
                    maxLength={MAX_NAME_LENGTH}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <ColourPicker value={color} onChange={setColor} />
              </div>

              <IconPicker value={icon} onChange={setIcon} />

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" disabled={busy || !name.trim()} type="submit">
                  {busy && <span className="spinner" />}
                  Add category
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

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
                        <input
                          className="input"
                          autoFocus
                          maxLength={MAX_NAME_LENGTH}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
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
                          disabled={editBusy || !editName.trim()}
                          onClick={() => saveEdit(c.id)}
                        >
                          {editBusy && <span className="spinner" />}
                          Save
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}

                  {!editing && c.isPropertyRental && <CategoryDocuments category={c} />}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
