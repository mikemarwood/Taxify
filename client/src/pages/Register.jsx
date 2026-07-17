import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

const PLANS = [
  { value: 'individual', name: 'Individual', price: '$49/yr', text: '1 user' },
  { value: 'family', name: 'Family', price: '$79/yr', text: 'Account holder + 1 extra user' },
];

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [planType, setPlanType] = useState('individual');
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await register(name, email, password, planType);
      setPendingEmail(result.email);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (pendingEmail) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step to activate your account.">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          We've sent an activation link to <strong style={{ color: 'var(--text)' }}>{pendingEmail}</strong>. Click it
          to activate your account and start your 14-day free trial — no card required.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 20, textAlign: 'center' }}>
          Didn't get it? <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 600 }}>Back to login</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="Start a 14-day free trial — no card required.">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label">Full name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            8+ characters, with an uppercase letter, a lowercase letter, and a number.
          </p>
        </div>
        <div>
          <label className="label">Plan</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {PLANS.map((p) => {
              const active = planType === p.value;
              return (
                <button
                  type="button"
                  key={p.value}
                  onClick={() => setPlanType(p.value)}
                  className="card"
                  style={{
                    padding: '12px 14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: active ? '1px solid var(--violet)' : '1px solid var(--border)',
                    boxShadow: active ? '0 0 0 1px var(--violet)' : undefined,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>{p.price}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.text}</div>
                </button>
              );
            })}
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit" style={{ marginTop: 8 }}>
          {busy && <span className="spinner" />}
          Start free trial
        </button>
      </form>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 20, textAlign: 'center' }}>
        Already have an account? <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 600 }}>Log in</Link>
      </p>
    </AuthLayout>
  );
}
