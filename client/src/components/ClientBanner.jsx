import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';

function countdown(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 1) return `${hours}h ${minutes}m left`;
  return `${Math.max(1, minutes)}m left`;
}

// Sits above everything while an accountant has a client open. Whose books
// you're reading is the one thing you cannot afford to be wrong about when you
// act for several people, and the window closing is not something to discover
// by being logged out mid-sentence.
export default function ClientBanner() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(() => countdown(user?.activeClient?.expiresAt));

  const expiresAt = user?.activeClient?.expiresAt;

  useEffect(() => {
    if (!expiresAt) return undefined;
    const tick = () => setLeft(countdown(expiresAt));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [expiresAt]);

  // Having a client open is the whole condition. It used to also require
  // role === 'accountant', which meant an account holder who keeps their own
  // books *and* does someone else's got no banner, no countdown, and — since
  // this is the only place that calls /auth/clients/exit — no way back to their
  // own records until the token expired on its own.
  if (!user?.activeClient) return null;

  const client = user.activeClient;
  const expiring = left && (left === 'expired' || /^\d+m left$/.test(left));

  async function switchClient() {
    setBusy(true);
    try {
      await api.post('/auth/clients/exit');
      await refresh();
      navigate('/clients');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ y: -40 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="app-banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1500,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 18px',
        background: expiring ? 'var(--amber)' : 'var(--nav-bg)',
        color: expiring ? '#1a1200' : 'var(--nav-text-active)',
        boxShadow: '0 2px 10px rgba(16, 24, 40, 0.18)',
      }}
    >
      <Icon name="briefcase" size={17} />
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{client.businessName || client.name}</span>
      <span style={{ fontSize: 12.5, flex: 1, minWidth: 200, opacity: expiring ? 1 : 0.85 }}>
        Read-only accountant access
        {client.financialYears ? ` · FY ${client.financialYears.join(', ')} only` : ' · all financial years'}
        {left ? ` · ${left}` : ''}
      </span>
      <button
        type="button"
        onClick={switchClient}
        disabled={busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 14px',
          borderRadius: 'var(--radius-sm)',
          border: expiring ? 'none' : '1px solid rgba(255, 255, 255, 0.25)',
          background: expiring ? '#1a1200' : 'rgba(255, 255, 255, 0.12)',
          color: '#fff',
          fontSize: 12.5,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {busy && <span className="spinner" />}
        Switch client
      </button>
    </motion.div>
  );
}
