import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

const PLANS = [
  { value: 'individual', name: 'Individual', price: '$49/yr', text: '1 user' },
  { value: 'family', name: 'Family', price: '$79/yr', text: 'Account holder + 1 extra user' },
];

const COUNTRIES = ['Australia', 'New Zealand', 'United Kingdom', 'United States', 'Canada', 'Other'];

const REFERRAL_SOURCES = [
  { value: '', label: 'Prefer not to say' },
  { value: 'search', label: 'Search engine' },
  { value: 'social', label: 'Social media' },
  { value: 'friend', label: 'Friend or colleague' },
  { value: 'accountant', label: 'Accountant / bookkeeper' },
  { value: 'other', label: 'Other' },
];

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [planType, setPlanType] = useState('individual');
  const [businessName, setBusinessName] = useState('');
  const [country, setCountry] = useState('Australia');
  const [referralSource, setReferralSource] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (!termsAccepted) return;
    setBusy(true);
    try {
      const result = await register({
        name,
        email,
        password,
        planType,
        country,
        businessName: businessName.trim() || undefined,
        referralSource: referralSource || undefined,
        termsAccepted,
      });
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Business name (optional)</label>
            <input className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
          <div>
            <label className="label">Country</label>
            <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">How did you hear about us? (optional)</label>
          <select className="input" value={referralSource} onChange={(e) => setReferralSource(e.target.value)}>
            {REFERRAL_SOURCES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            required
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            I agree to the{' '}
            <Link to="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontWeight: 600 }}>
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontWeight: 600 }}>
              Privacy Policy
            </Link>
          </span>
        </label>
        <button className="btn btn-primary" disabled={busy || !termsAccepted} type="submit" style={{ marginTop: 8 }}>
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
