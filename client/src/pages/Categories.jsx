import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import { ICON_OPTIONS, iconEmoji } from '../lib/categoryIcons.js';

const SWATCHES = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#ef4444', '#eab308', '#14b8a6', '#a1a1aa'];

const MAX_NAME_LENGTH = 40;

function IconPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 220 }}>
      {ICON_OPTIONS.map((icon) => (
        <button
          type="button"
          key={icon}
          onClick={() => onChange(icon)}
          title={icon}
          style={{
            width: 26,
            height: 26,
            fontSize: 14,
            borderRadius: 8,
            background: value === icon ? 'var(--bg-elevated)' : 'transparent',
            border: value === icon ? '1px solid var(--violet)' : '1px solid transparent',
            cursor: 'pointer',
          }}
        >
          {iconEmoji(icon)}
        </button>
      ))}
    </div>
  );
}

export default function Categories() {
  const toast = useToast();
  const [categories, setCategories] = useState(null);
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
    setConfirmingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id) {
    if (!editName.trim()) return;
    setEditBusy(true);
    try {
      await api.patch(`/categories/${id}`, { name: editName, color: editColor, icon: editIcon });
      toast('Category updated', 'success');
      setEditingId(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setEditBusy(false);
    }
  }

  function startDelete(id) {
    setConfirmingId(id);
    setConfirmText('');
  }

  function cancelDelete() {
    setConfirmingId(null);
    setConfirmText('');
  }

  async function confirmDelete(id) {
    try {
      await api.delete(`/categories/${id}`);
      cancelDelete();
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Categories</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Everyone starts with the same defaults — add your own on top.
      </p>

      <form onSubmit={onAdd} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="New category name"
            maxLength={MAX_NAME_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {SWATCHES.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setColor(s)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: s,
                  border: color === s ? '2px solid white' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          <button className="btn btn-primary" disabled={busy} type="submit">
            Add
          </button>
        </div>
        <IconPicker value={icon} onChange={setIcon} />
      </form>

      {categories === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            {categories.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: 20 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 18px',
                  borderBottom: i < categories.length - 1 ? '1px solid var(--border)' : 'none',
                  flexWrap: 'wrap',
                }}
              >
                {editingId === c.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {SWATCHES.map((s) => (
                          <button
                            type="button"
                            key={s}
                            onClick={() => setEditColor(s)}
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              background: s,
                              border: editColor === s ? '2px solid white' : '2px solid transparent',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          />
                        ))}
                      </div>
                      <input
                        className="input"
                        autoFocus
                        maxLength={MAX_NAME_LENGTH}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ flex: 1, minWidth: 120, padding: '6px 10px', fontSize: 13 }}
                      />
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        disabled={editBusy || !editName.trim()}
                        onClick={() => saveEdit(c.id)}
                      >
                        {editBusy && <span className="spinner" />}
                        Save
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                    <IconPicker value={editIcon} onChange={setEditIcon} />
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{iconEmoji(c.icon)}</span>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: c.color }} />
                    <div style={{ flex: 1, fontWeight: 600 }}>{c.name}</div>

                    {confirmingId === c.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          className="input"
                          autoFocus
                          placeholder='Type "delete"'
                          value={confirmText}
                          onChange={(e) => setConfirmText(e.target.value)}
                          style={{ width: 130, padding: '6px 10px', fontSize: 12 }}
                        />
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 12, padding: '6px 12px', background: 'var(--red)' }}
                          disabled={confirmText.trim().toLowerCase() !== 'delete'}
                          onClick={() => confirmDelete(c.id)}
                        >
                          Confirm
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={cancelDelete}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => startEdit(c)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => startDelete(c.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
