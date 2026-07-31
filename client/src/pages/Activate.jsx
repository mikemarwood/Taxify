import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { playSuccess, playError } from '../lib/sounds.js';
import PasswordFields, { isStrongPassword } from '../components/PasswordFields.jsx';

export default function Activate() {
  const { activate, checkActivationToken, resendActivation } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('checking'); // checking | ready | saving | success | error
  const [errorMessage, setErrorMessage] = useState('');
  const [account, setAccount] = useState(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // The link is checked before the form appears, so nobody chooses a password
  // only to be told the link expired.
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('This activation link is missing its token.');
      return;
    }
    checkActivationToken(token)
      .then((data) => {
        setAccount(data);
        setStatus('ready');
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err.message);
      });
  }, [token, checkActivationToken]);

  const matches = password.length > 0 && password === confirmPassword;
  const canSubmit = isStrongPassword(password) && matches && status === 'ready';

  async function onSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setStatus('saving');
    try {
      await activate(token, password);
      playSuccess();
      setStatus('success');
      setTimeout(() => navigate('/'), 1400);
    } catch (err) {
      playError();
      setStatus('ready');
      toast(err.message, 'error');
    }
  }

  if (status === 'checking') {
    return (
      <AuthLayout title="Activating…" subtitle="Just checking your link.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 14 }}>
          <span className="spinner" />
          Checking your activation link…
        </div>
      </AuthLayout>
    );
  }

  if (status === 'success') {
    return (
      <AuthLayout title="You're all set" subtitle="Taking you to your dashboard.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
          <Icon name="check-circle" size={38} style={{ color: 'var(--emerald)' }} />
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            Your account is active and your 14-day trial has started. We've emailed you a confirmation.
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'error') {
    return (
      <AuthLayout title="That link didn't work" subtitle="Links expire after 5 days.">
        <ExpiredLink message={errorMessage} onResend={resendActivation} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose your password" subtitle="The last step — then you're in.">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {account?.email && (
          <div
            style={{
              fontSize: 13,
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
            }}
          >
            Setting the password for <strong>{account.email}</strong>
          </div>
        )}

        <PasswordFields
          password={password}
          setPassword={setPassword}
          confirmPassword={confirmPassword}
          setConfirmPassword={setConfirmPassword}
          autoFocus
        />

        <button className="btn btn-primary" type="submit" disabled={!canSubmit || status === 'saving'}>
          {status === 'saving' && <span className="spinner" />}
          Activate my account
        </button>
      </form>
    </AuthLayout>
  );
}

// An expired link is recoverable: a new one can be sent, throttled to once
// every five minutes with the wait shown as it counts down.
function ExpiredLink({ message, onResend }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  async function submit(event) {
    event.preventDefault();
    if (!email.trim() || secondsLeft > 0) return;
    setBusy(true);
    try {
      const wait = await onResend(email);
      setSecondsLeft(wait);
      toast('If that account is waiting to be activated, a new link is on its way', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, color: 'var(--red)' }}>
        <Icon name="alert" size={18} style={{ marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text)' }}>{message}</p>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Enter the address you signed up with and we'll send a fresh link. If the account was already removed you're
        welcome to sign up again.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          className="input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value.toLowerCase())}
          autoComplete="email"
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || secondsLeft > 0}>
          {busy && <span className="spinner" />}
          {secondsLeft > 0 ? `Resend available in ${mm}:${ss}` : 'Send a new activation link'}
        </button>
      </form>

      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', fontSize: 13 }}>
        <Link to="/register" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          Sign up again
        </Link>
        <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
