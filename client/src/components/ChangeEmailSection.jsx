import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import { formatDateTime } from '../lib/dates.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Changing the address you sign in with is not a profile edit — it has to be
// proved at the new address before it takes effect. Until then the account
// carries on exactly as it is, which is what makes a typo here harmless.
export default function ChangeEmailSection({ user }) {
  const toast = useToast();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [check, setCheck] = useState({ state: 'idle' });
  const debounce = useRef(null);
  const requestId = useRef(0);

  useEffect(() => {
    api
      .get('/auth/email-change')
      .then((res) => setPending(res.data.pending))
      .catch(() => setPending(null));
  }, []);

  // Checked as it is typed, so nobody fills in a password and waits on an
  // email for an address that was never going to work.
  useEffect(() => {
    const value = newEmail.trim().toLowerCase();
    clearTimeout(debounce.current);

    if (!value) return setCheck({ state: 'idle' });
    if (!EMAIL_PATTERN.test(value)) return setCheck({ state: 'invalid', message: 'That doesn’t look like an email address' });
    if (value === user.email) return setCheck({ state: 'invalid', message: 'That is already the address on this account' });

    setCheck({ state: 'checking' });
    const id = ++requestId.current;
    debounce.current = setTimeout(() => {
      api
        .get(`/auth/email-available?email=${encodeURIComponent(value)}`)
        .then((res) => {
          // A slower earlier request must not overwrite a newer answer.
          if (id !== requestId.current) return;
          setCheck(
            res.data.available
              ? { state: 'available', message: 'That address is available' }
              : { state: 'taken', message: res.data.reason || 'An account with that email already exists' }
          );
        })
        .catch(() => id === requestId.current && setCheck({ state: 'idle' }));
    }, 400);

    return () => clearTimeout(debounce.current);
  }, [newEmail, user.email]);

  const canSubmit = check.state === 'available' && password.length > 0 && !busy;

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await api.post('/auth/email-change', {
        newEmail: newEmail.trim().toLowerCase(),
        currentPassword: password,
      });
      setPending(res.data.pending);
      setNewEmail('');
      setPassword('');
      setCheck({ state: 'idle' });
      toast('Confirmation email sent — open it from the new inbox', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function cancelPending() {
    try {
      await api.delete('/auth/email-change');
      setPending(null);
      toast('Email change cancelled', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const toneFor = {
    checking: 'var(--text-muted)',
    available: 'var(--emerald)',
    taken: 'var(--red)',
    invalid: 'var(--red)',
  }[check.state];

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontWeight: 700 }}>Email address</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          You sign in with <strong style={{ color: 'var(--text)' }}>{user.email}</strong>
        </div>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {pending ? (
          <motion.div
            key="pending"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 11,
              padding: 14,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-ring)',
            }}
          >
            <span style={{ color: 'var(--accent)', marginTop: 1 }}>
              <Icon name="mail" size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>Waiting for confirmation</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.55 }}>
                We've emailed <strong style={{ color: 'var(--text)' }}>{pending.email}</strong>. Open the link in that
                inbox to finish the change — it expires{' '}
                {formatDateTime(pending.expiresAt)}
                . Until then you carry on signing in with {user.email}.
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12.5, padding: '6px 12px', marginTop: 10 }}
                onClick={cancelPending}
              >
                Cancel this change
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={onSubmit}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div>
              <label className="label">New email address</label>
              <input
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                maxLength={190}
                value={newEmail}
                // Addresses are stored lowercase, so the field shows what will
                // actually be saved rather than correcting it after the fact.
                onChange={(e) => setNewEmail(e.target.value.replace(/\s/g, '').toLowerCase())}
              />
              <div style={{ minHeight: 18, marginTop: 5 }}>
                {check.state !== 'idle' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: toneFor }}>
                    {check.state === 'checking' ? (
                      <>
                        <span className="spinner" />
                        Checking…
                      </>
                    ) : (
                      <>
                        <Icon name={check.state === 'available' ? 'check-circle' : 'alert'} size={13} />
                        {check.message}
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="label">Current password</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '5px 0 0', lineHeight: 1.5 }}>
                Asked for because an open session shouldn't be enough to move the account to a different address.
              </p>
            </div>

            <button className="btn btn-primary" type="submit" disabled={!canSubmit} style={{ alignSelf: 'flex-start' }}>
              {busy && <span className="spinner" />}
              Send confirmation email
            </button>

            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
              Nothing changes until you open the link we send to the new address. Your account stays active on{' '}
              {user.email} the whole time.
            </p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
