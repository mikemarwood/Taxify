import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Icon from '../components/Icon.jsx';
import PasswordFields, { isStrongPassword } from '../components/PasswordFields.jsx';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { playError, playSuccess } from '../lib/sounds.js';
import { autoFocusFields } from '../lib/device.js';

export default function ResetPassword() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('checking'); // checking | ready | saving | done | error
  const [errorMessage, setErrorMessage] = useState('');
  const [account, setAccount] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // The link is validated before the form appears, so nobody picks a password
  // only to be told the link had already expired.
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('This reset link is missing its token.');
      return;
    }
    api
      .get(`/auth/reset-password/check?token=${encodeURIComponent(token)}`)
      .then((res) => {
        setAccount(res.data);
        setStatus('ready');
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err.message);
      });
  }, [token]);

  const matches = password.length > 0 && password === confirmPassword;
  const canSubmit = isStrongPassword(password) && matches && status === 'ready';

  async function onSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setStatus('saving');
    try {
      await api.post('/auth/reset-password', { token, password });
      playSuccess();
      setStatus('done');
    } catch (err) {
      playError();
      setStatus('ready');
      toast(err.message, 'error');
    }
  }

  if (status === 'checking') {
    return (
      <AuthLayout title="One moment" subtitle="Checking your reset link.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 14 }}>
          <span className="spinner" />
          Checking your link…
        </div>
      </AuthLayout>
    );
  }

  if (status === 'done') {
    return (
      <AuthLayout title="Password updated" subtitle="You can sign in with it now.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--emerald)' }}>
            <Icon name="check-circle" size={38} />
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            Your password has been changed and we've emailed you a confirmation. The reset link no longer works.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            Sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'error') {
    return (
      <AuthLayout title="That link didn't work" subtitle="Reset links expire after 24 hours.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, color: 'var(--red)' }}>
            <Icon name="alert" size={18} style={{ marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text)' }}>{errorMessage}</p>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Links can only be used once, so this will also happen if the password was already reset. Ask for a
            fresh one and it'll arrive within a minute.
          </p>
          <Link to="/forgot-password" className="btn btn-primary" style={{ textAlign: 'center' }}>
            Send a new link
          </Link>
          <Link to="/login" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textAlign: 'center' }}>
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Then you're back in.">
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
            Resetting the password for <strong>{account.email}</strong>
          </div>
        )}

        <PasswordFields
          password={password}
          setPassword={setPassword}
          confirmPassword={confirmPassword}
          setConfirmPassword={setConfirmPassword}
          autoFocus={autoFocusFields}
        />

        <button className="btn btn-primary" type="submit" disabled={!canSubmit || status === 'saving'}>
          {status === 'saving' && <span className="spinner" />}
          Change my password
        </button>
      </form>
    </AuthLayout>
  );
}
