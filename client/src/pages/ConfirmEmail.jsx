import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { playSuccess, playError } from '../lib/sounds.js';

// Opened from the new inbox, which may not be the browser that asked for the
// change — so this works signed in or not. If there is a session, it is
// refreshed so the address on screen stops being the old one.
export default function ConfirmEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { user, refresh } = useAuth();
  const [status, setStatus] = useState('working');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setStatus('error');
      setMessage('This confirmation link is missing its token.');
      return;
    }

    api
      .post('/auth/confirm-email', { token })
      .then(async (res) => {
        setEmail(res.data.email);
        setStatus('done');
        playSuccess();
        if (user) await refresh().catch(() => {});
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.message);
        playError();
      });
    // Deliberately runs once: the token is single-use, so a re-run would
    // report a valid change as an expired link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'working') {
    return (
      <AuthLayout title="Confirming…" subtitle="Just checking your link.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 14 }}>
          <span className="spinner" />
          Confirming your new email address…
        </div>
      </AuthLayout>
    );
  }

  if (status === 'error') {
    return (
      <AuthLayout title="That link didn't work" subtitle="Confirmation links last 24 hours.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center' }}>
          <Icon name="alert" size={36} style={{ color: 'var(--red)' }} />
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{message}</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Your account is untouched and still signs in with the address it had. Request the change again from
            Account settings.
          </p>
          <Link to="/account?tab=security" className="btn btn-ghost">
            Go to account settings
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Email address confirmed" subtitle="That's the change done.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center' }}>
        <Icon name="check-circle" size={38} style={{ color: 'var(--emerald)' }} />
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          You now sign in with <strong>{email}</strong>. We've let the old address know.
        </p>
        <Link to={user ? '/account?tab=security' : '/login'} className="btn btn-primary">
          {user ? 'Back to account settings' : 'Sign in'}
        </Link>
      </div>
    </AuthLayout>
  );
}
