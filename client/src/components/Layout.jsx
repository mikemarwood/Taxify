import { useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/add', label: 'Add Expense', icon: '➕' },
  { to: '/categories', label: 'Categories', icon: '🏷️' },
  { to: '/reports', label: 'Reports', icon: '📈' },
];

export default function Layout({ children }) {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const avatarInputRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function onAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    const form = new FormData();
    form.append('avatar', file);
    try {
      const res = await api.post('/auth/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUser((u) => ({ ...u, avatarUrl: `${res.data.avatarUrl}?t=${Date.now()}` }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploadingAvatar(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <aside
        className="scrollbar-slim"
        style={{
          width: 220,
          borderRight: '1px solid var(--border)',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <img src="/logo.svg" alt="Taxify" width="34" height="34" />
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: -0.5 }}>Taxify</span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[...navItems, ...(user?.isAdmin ? [{ to: '/admin', label: 'Administration', icon: '🛠️' }] : [])].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                color: isActive ? 'white' : 'var(--text-muted)',
                background: isActive ? 'var(--gradient-brand)' : 'transparent',
              })}
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              title="Change avatar"
              style={{
                border: 'none',
                background: 'none',
                padding: 0,
                lineHeight: 0,
                borderRadius: '50%',
                cursor: uploadingAvatar ? 'default' : 'pointer',
                opacity: uploadingAvatar ? 0.6 : 1,
              }}
            >
              <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={36} />
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={onAvatarChange} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', minWidth: 0 }}>
              Signed in as
              <div
                style={{
                  color: 'var(--text)',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user?.name}
              </div>
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13 }}
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Log out
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px 0', lineHeight: 1.5 }}>
            © {new Date().getFullYear()} Taxify · Powered by{' '}
            <a href="https://mikesapphub.com" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
              Mikes App Hub
            </a>
          </div>
        </div>
      </aside>

      <motion.main
        key={typeof window !== 'undefined' ? window.location.pathname : 'main'}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        style={{ flex: 1, padding: '32px 40px', maxWidth: 1100 }}
      >
        {children}
      </motion.main>
    </div>
  );
}
