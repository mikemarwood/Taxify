import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import ViewAsBanner from './ViewAsBanner.jsx';
import OtpOnboardingModal from './OtpOnboardingModal.jsx';
import { playClick } from '../lib/sounds.js';
import { formatMoney } from '../lib/money.js';
import { describeSubscription } from '../lib/subscription.js';

// Eight equal-weight links in one column give no sense of where anything is.
// Grouping them under headings means the eye lands on a section first and a
// link second, which is how people actually look for "where do I add a receipt".
const navGroups = [
  {
    title: null,
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/reports', label: 'Reports', icon: 'chart' },
    ],
  },
  {
    title: 'Expenses',
    items: [
      { to: '/add', label: 'Add expense', icon: 'plus-circle' },
      { to: '/expenses', label: 'All expenses', icon: 'list' },
      { to: '/categories', label: 'Categories', icon: 'tag' },
      { to: '/recycle-bin', label: 'Recycle bin', icon: 'trash' },
    ],
  },
  {
    title: 'Settings',
    items: [{ to: '/account', label: 'Account', icon: 'settings' }],
    adminItems: [{ to: '/admin', label: 'Administration', icon: 'wrench' }],
  },
];

// An accountant is here to look, not to file — the links they can't use are
// left out rather than shown and rejected.
const ACCOUNTANT_PATHS = ['/', '/expenses', '/reports', '/account'];

function NavItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={playClick}
      className="nav-item"
      style={({ isActive }) => ({
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13.5,
        fontWeight: isActive ? 600 : 500,
        textDecoration: 'none',
        color: isActive ? 'var(--nav-text-active)' : 'var(--nav-text)',
        background: isActive ? 'var(--nav-active-bg)' : 'transparent',
      })}
    >
      {({ isActive }) => (
        <>
          {/* Fluent marks the selected item with an accent pill on the leading
              edge rather than filling the whole row. */}
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
          <Icon name={item.icon} size={19} strokeWidth={isActive ? 2 : 1.8} style={{ color: isActive ? "var(--nav-accent)" : "inherit" }} />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [showMfaPrompt, setShowMfaPrompt] = useState(false);
  const billing = describeSubscription(user);

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
          toast(`Auto-added recurring expense: ${list[0].itemName} (${formatMoney(list[0].amount)})`, 'info');
        } else if (list.length > 1) {
          toast(`${list.length} recurring expenses were added automatically`, 'info');
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ViewAsBanner />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
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

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {navGroups
            .map((group) => {
              const items = [...group.items, ...(user?.isAdmin ? group.adminItems || [] : [])].filter(
                (i) => user?.role !== 'accountant' || ACCOUNTANT_PATHS.includes(i.to)
              );
              return { ...group, items };
            })
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.title || 'main'} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {group.title && (
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: 0.7,
                      textTransform: 'uppercase',
                      color: 'var(--nav-text)',
                      opacity: 0.55,
                      padding: '0 12px',
                      marginBottom: 3,
                    }}
                  >
                    {group.title}
                  </div>
                )}
                {group.items.map((item) => (
                  <NavItem key={item.to} item={item} />
                ))}
              </div>
            ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* One bordered block instead of loose rows: the avatar, who you are,
              which plan, and how long it lasts read as a single card rather
              than four things stacked at the bottom of the rail. */}
          <div
            style={{
              border: '1px solid var(--nav-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            <Link
              to="/account"
              title="Account settings"
              style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', minWidth: 0 }}
            >
              <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={32} />
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span
                  style={{
                    color: 'var(--nav-text-active)',
                    fontWeight: 600,
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user?.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--nav-text)',
                    opacity: 0.8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user?.role === 'owner'
                    ? `${user.planType === 'family' ? 'Family' : 'Individual'} plan`
                    : user?.role === 'accountant'
                    ? 'Accountant access'
                    : 'Family member'}
                </span>
              </span>
            </Link>

            {/* Trial state belongs with the plan: which plan you're on is no
                use if you don't know it's about to stop. */}
            {user?.role === 'owner' && (
              <Link
                to="/account?tab=billing"
                title={billing.detail}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  padding: '5px 8px',
                  borderRadius: 6,
                  color: billing.tone === 'bad' || billing.tone === 'warn' ? '#1a1200' : 'var(--nav-text-active)',
                  background:
                    billing.tone === 'bad'
                      ? 'var(--red)'
                      : billing.tone === 'warn'
                      ? 'var(--amber)'
                      : 'rgba(255, 255, 255, 0.07)',
                }}
              >
                <Icon name={billing.state === 'active' ? 'check-circle' : 'info'} size={13} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {billing.label}
                </span>
              </Link>
            )}
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
    </div>
  );
}
