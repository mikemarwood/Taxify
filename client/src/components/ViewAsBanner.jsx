import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';

// Sits above everything while an admin is viewing someone else's account.
// Deliberately loud and fixed to the top: the whole risk of a support tool
// like this is forgetting you're in it and reading someone else's numbers as
// your own.
export default function ViewAsBanner() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!user?.viewedBy) return null;

  async function exit() {
    setBusy(true);
    try {
      const res = await api.post('/auth/exit-view-as');
      setUser(res.data.user);
      navigate('/admin');
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
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1500,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 18px',
        background: 'var(--amber)',
        color: '#1a1200',
        boxShadow: '0 2px 10px rgba(16, 24, 40, 0.18)',
      }}
    >
      <Icon name="alert" size={17} />
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>Viewing as {user.name}</span>
      <span style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>
        You're signed in as an administrator ({user.viewedBy.email}). This account is read-only — nothing you do
        here can change their records.
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 14px',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          background: '#1a1200',
          color: '#fff',
          fontSize: 12.5,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {busy && <span className="spinner" />}
        <Icon name="arrow-left" size={13} />
        Exit view
      </button>
    </motion.div>
  );
}
