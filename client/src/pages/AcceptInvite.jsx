import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

export default function AcceptInvite() {
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast('Passwords do not match', 'error');
      return;
    }
    setBusy(true);
    try {
      await acceptInvite(token, password);
      toast('Welcome to Taxify!', 'success');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Invalid invitation" subtitle="This link is missing its token.">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 600 }}>Back to login</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set your password" subtitle="Finish creating your account to accept the invitation.">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label">Password</label>
          <input className="input" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            8+ characters, with an uppercase letter, a lowercase letter, and a number.
          </p>
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input
            className="input"
            required
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit" style={{ marginTop: 8 }}>
          {busy && <span className="spinner" />}
          Activate my account
        </button>
      </form>
    </AuthLayout>
  );
}
