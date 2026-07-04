import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(name, email, password);
      toast('Account created — welcome to Taxify!', 'success');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Get a set of ready-made tax categories from day one.">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label">Full name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            8+ characters, with an uppercase letter, a lowercase letter, and a number.
          </p>
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit" style={{ marginTop: 8 }}>
          {busy && <span className="spinner" />}
          Create account
        </button>
      </form>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 20, textAlign: 'center' }}>
        Already have an account? <Link to="/login" style={{ color: 'var(--cyan)', fontWeight: 600 }}>Log in</Link>
      </p>
    </AuthLayout>
  );
}
