import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import OtpOnboardingModal from './OtpOnboardingModal.jsx';
import { playClick } from '../lib/sounds.js';

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
          width: 232,
          flexShrink: 0,
          // A dark rail against light content: the chrome recedes and the
          // numbers stay the brightest thing on screen.
          background: 'var(--nav-bg)',
          color: 'var(--nav-text)',
          borderRight: '1px solid var(--nav-border)',
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <img src="/logo.svg" alt="Taxify" width="34" height="34" />
          <span style={{ fontWeight: 700, fontSize: 19, letterSpacing: -0.4, color: 'var(--nav-text-active)' }}>Taxify</span>
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
              onClick={playClick}
              className="nav-item"
              style={({ isActive }) => ({
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                textDecoration: 'none',
                color: isActive ? 'var(--nav-text-active)' : 'var(--nav-text)',
                background: isActive ? 'var(--nav-active-bg)' : 'transparent',
              })}
            >
              {({ isActive }) => (
                <>
                  {/* Fluent marks the selected item with an accent pill on the
                      leading edge rather than filling the whole row. */}
                  {isActive && (
                    <motion.span
                      layoutId="nav-indicator"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: '50%',
                        translateY: '-50%',
                        width: 3,
                        height: 16,
                        borderRadius: 999,
                        background: 'var(--nav-accent)',
                      }}
                    />
                  )}
                  <Icon name={item.icon} size={17} style={{ color: isActive ? 'var(--nav-accent)' : 'inherit' }} />
                  {item.label}
                </>
              )}
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
              style={{ fontSize: 12.5, color: 'var(--nav-text)', minWidth: 0, textDecoration: 'none' }}
              title="Account settings"
            >
              Signed in as
              <div
                style={{
                  color: 'var(--nav-text-active)',
                  fontWeight: 600,
                  fontSize: 13.5,
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
            className="btn nav-btn"
            style={{ fontSize: 13 }}
            onClick={async () => {
              playClick();
              await logout();
              navigate('/login');
            }}
          >
            Log out
          </button>
          <div style={{ fontSize: 11, color: 'var(--nav-text)', opacity: 0.75, padding: '4px 8px 0', lineHeight: 1.5 }}>
            © {new Date().getFullYear()} Taxify · Powered by{' '}
            <a href="https://mikesapphub.com" target="_blank" rel="noreferrer" style={{ color: 'var(--nav-accent)' }}>
              Mikes App Hub
            </a>
          </div>
        </div>
      </aside>

      {/* Keyed on the router's location, not window's, so the entrance
          actually replays on every navigation. Fluent page transitions come
          in from below and settle quickly — long enough to read as motion,
          short enough not to sit between you and the data. */}
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{ flex: 1, padding: '32px 40px', maxWidth: 1180 }}
      >
        {children}
      </motion.main>

      {location.pathname !== '/add' && user?.role !== 'accountant' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.15 }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          style={{ position: 'fixed', right: 32, bottom: 32, zIndex: 900 }}
        >
          <Link
            to="/add"
            title="Add expense"
            onClick={playClick}
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent)',
              color: 'white',
              textDecoration: 'none',
              boxShadow: '0 4px 10px rgba(16, 24, 40, 0.14), 0 12px 28px rgba(0, 103, 192, 0.22)',
            }}
          >
            <Icon name="plus" size={24} strokeWidth={2.2} />
          </Link>
        </motion.div>
      )}

      {showMfaPrompt && <OtpOnboardingModal onClose={() => setShowMfaPrompt(false)} />}
    </div>
  );
}
