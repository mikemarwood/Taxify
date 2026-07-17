import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

export default function Activate() {
  const { activate, resendActivation } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('activating'); // activating | success | error
  const [errorMessage, setErrorMessage] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('This activation link is missing its token.');
      return;
    }
    activate(token)
      .then(() => {
        setStatus('success');
        setTimeout(() => navigate('/'), 1200);
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onResend(e) {
    e.preventDefault();
    setResendBusy(true);
    try {
      await resendActivation(resendEmail);
      setResendSent(true);
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <AuthLayout
      title={status === 'success' ? 'Account activated' : 'Activating your account'}
      subtitle={status === 'success' ? 'Redirecting you in…' : 'Just a moment.'}
    >
      {status === 'activating' && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
          <span className="spinner" style={{ borderTopColor: 'var(--violet)', borderColor: 'rgba(37,99,235,0.2)' }} />
        </div>
      )}

      {status === 'success' && (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center' }}>
          Your 14-day free trial has started. Taking you to your dashboard…
        </p>
      )}

      {status === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 14, color: 'var(--red)', margin: 0 }}>{errorMessage}</p>
          {resendSent ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              If that email has a pending activation, a new link is on its way.
            </p>
          ) : (
            <form onSubmit={onResend} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="label">Resend activation email</label>
              <input
                className="input"
                type="email"
                required
                placeholder="you@example.com"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value.toLowerCase())}
              />
              <button className="btn btn-primary" type="submit" disabled={resendBusy}>
                {resendBusy && <span className="spinner" />}
                Resend activation email
              </button>
            </form>
          )}
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
            <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 600 }}>Back to login</Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
