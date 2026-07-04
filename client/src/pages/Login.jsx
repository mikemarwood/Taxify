import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to keep tracking your deductions.">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit" style={{ marginTop: 8 }}>
          {busy && <span className="spinner" />}
          Log in
        </button>
      </form>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 20, textAlign: 'center' }}>
        No account yet? <Link to="/register" style={{ color: 'var(--cyan)', fontWeight: 600 }}>Create one</Link>
      </p>
    </AuthLayout>
  );
}
