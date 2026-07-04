import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';

const SWATCHES = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#ef4444', '#eab308', '#14b8a6', '#a1a1aa'];

export default function Categories() {
  const toast = useToast();
  const [categories, setCategories] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/categories').then((res) => setCategories(res.data.categories));
  }

  useEffect(load, []);

  async function onAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/categories', { name, color });
      setName('');
      toast('Category added', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/categories/${id}`);
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

      <form onSubmit={onAdd} className="card" style={{ padding: 20, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <input className="input" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
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
                }}
              >
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: c.color }} />
                <div style={{ flex: 1, fontWeight: 600 }}>{c.name}</div>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => onDelete(c.id)}>
                  Delete
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
