import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';

const SWATCHES = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#ef4444', '#eab308', '#14b8a6', '#a1a1aa'];

export default function Admin() {
  const [tab, setTab] = useState('users');

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Administration</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Manage user accounts and the default category template.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={tab === 'users' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('users')}>
          Users
        </button>
        <button className={tab === 'categories' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('categories')}>
          Default categories
        </button>
        <button className={tab === 'settings' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'categories' && <DefaultCategoriesTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState(null);

  function load() {
    api.get('/admin/users').then((res) => setUsers(res.data.users));
  }
  useEffect(load, []);

  async function toggleAdmin(u) {
    try {
      await api.patch(`/admin/users/${u.id}`, { isAdmin: !u.isAdmin });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteUser(u) {
    if (!window.confirm(`Delete ${u.name} (${u.email})? This permanently removes their categories and expenses.`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast('User deleted', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (users === null) return <SkeletonList rows={4} />;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <AnimatePresence initial={false}>
        {users.map((u, i) => (
          <motion.div
            key={u.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 18px',
              borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {u.name} {u.id === me.id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(you)</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {u.email} · {u.expenseCount} expense{u.expenseCount === 1 ? '' : 's'} · joined{' '}
                {new Date(u.createdAt).toLocaleDateString()}
              </div>
            </div>
            {u.isAdmin && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 999,
                  color: 'var(--violet)',
                  background: 'rgba(139, 92, 246, 0.15)',
                }}
              >
                Administrator
              </span>
            )}
            {u.id !== me.id && (
              <>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                  onClick={() => toggleAdmin(u)}
                >
                  {u.isAdmin ? 'Demote' : 'Promote'}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                  onClick={() => deleteUser(u)}
                >
                  Delete
                </button>
              </>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SettingsTab() {
  const toast = useToast();
  const [registrationEnabled, setRegistrationEnabled] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/settings').then((res) => setRegistrationEnabled(res.data.registrationEnabled));
  }, []);

  async function toggle() {
    const next = !registrationEnabled;
    setBusy(true);
    try {
      await api.patch('/admin/settings', { registrationEnabled: next });
      setRegistrationEnabled(next);
      toast(next ? 'Registrations are now open' : 'Registrations are now closed', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (registrationEnabled === null) return <SkeletonList rows={1} />;

  return (
    <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 700 }}>New account registration</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          {registrationEnabled
            ? 'Anyone can currently create a new Taxify account.'
            : 'Sign-ups are closed — existing accounts can still log in normally.'}
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={toggle} style={{ flexShrink: 0 }}>
        {registrationEnabled ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  );
}

function DefaultCategoriesTab() {
  const toast = useToast();
  const [categories, setCategories] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/admin/default-categories').then((res) => setCategories(res.data.categories));
  }
  useEffect(load, []);

  async function onAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/default-categories', { name, color });
      setName('');
      toast('Default category added — new signups will get it', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/admin/default-categories/${id}`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -12, marginBottom: 20 }}>
        This is the starter set every new account is seeded with. Changes here only affect future signups — existing
        users keep managing their own categories independently.
      </p>

      <form onSubmit={onAdd} className="card" style={{ padding: 20, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <input className="input" placeholder="New default category name" value={name} onChange={(e) => setName(e.target.value)} />
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
