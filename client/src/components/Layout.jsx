import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/add', label: 'Add Expense', icon: '➕' },
  { to: '/categories', label: 'Categories', icon: '🏷️' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
          {navItems.map((item) => (
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
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 8px' }}>
            Signed in as
            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{user?.name}</div>
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
