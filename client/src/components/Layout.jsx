import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import OtpOnboardingModal from './OtpOnboardingModal.jsx';

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/expenses', label: 'Expenses', icon: 'list' },
  { to: '/add', label: 'Add Expense', icon: 'plus-circle' },
  { to: '/categories', label: 'Categories', icon: 'tag' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/recycle-bin', label: 'Recycle Bin', icon: 'trash' },
  { to: '/account', label: 'Account', icon: 'settings' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [showMfaPrompt, setShowMfaPrompt] = useState(false);

  useEffect(() => {
    if (user?.mfaPromptDue) {
      const id = setTimeout(() => setShowMfaPrompt(true), 800);
      return () => clearTimeout(id);
    }
  }, [user?.mfaPromptDue]);

  useEffect(() => {
    api
      .get('/expenses/auto-generated/unnotified')
      .then((res) => {
        const list = res.data.expenses;
        if (list.length === 1) {
          toast(`Auto-added recurring expense: ${list[0].itemName} ($${list[0].amount.toFixed(2)})`, 'info');
        } else if (list.length > 1) {
          toast(`${list.length} recurring expenses were added automatically`, 'info');
        }
      })
      .catch(() => {});
  }, []);

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
          {[
            ...(user?.role === 'accountant' ? navItems.filter((i) => ['/', '/expenses', '/reports', '/account'].includes(i.to)) : navItems),
            ...(user?.isAdmin ? [{ to: '/admin', label: 'Administration', icon: 'wrench' }] : []),
          ].map((item) => (
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
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
            <Link to="/account" title="Account settings" style={{ lineHeight: 0 }}>
              <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={36} />
            </Link>
            <Link
              to="/account"
              style={{ fontSize: 13, color: 'var(--text-muted)', minWidth: 0, textDecoration: 'none' }}
              title="Account settings"
            >
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
            </Link>
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
            <a href="https://mikesapphub.com" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
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

      {location.pathname !== '/add' && user?.role !== 'accountant' && (
        <Link
          to="/add"
          title="Add expense"
          style={{
            position: 'fixed',
            right: 32,
            bottom: 32,
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--gradient-brand)',
            color: 'white',
            fontSize: 26,
            fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 8px 24px rgba(37, 99, 235, 0.45)',
            zIndex: 900,
          }}
        >
          +
        </Link>
      )}

      {showMfaPrompt && <OtpOnboardingModal onClose={() => setShowMfaPrompt(false)} />}
    </div>
  );
}
