import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import OtpBenefits from './OtpBenefits.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';

export default function OtpOnboardingModal({ onClose }) {
  const { setOtpEnabled } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function choose(enabled) {
    setBusy(true);
    try {
      if (enabled) {
        await setOtpEnabled(true);
        toast('Email login codes are now on', 'success');
      } else {
        await setOtpEnabled(false);
      }
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 6, 10, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1200,
          padding: 20,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="card"
          style={{ width: '100%', maxWidth: 420, padding: 32 }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔐</div>
          <h2 style={{ fontSize: 20, margin: '0 0 6px' }}>Add an extra layer of security?</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 20px' }}>
            Turn on email login codes (MFA) to protect your account. Here's what it does:
          </p>
          <OtpBenefits />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => choose(false)}>
              Not now
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => choose(true)}>
              {busy && <span className="spinner" />}
              Enable it
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0', textAlign: 'center' }}>
            You can change this any time in Account settings.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
