import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

function msToClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Login() {
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [publicDevice, setPublicDevice] = useState(false);
  const [busy, setBusy] = useState(false);

  const [otpState, setOtpState] = useState(null); // { userId, expiresAt }
  const [code, setCode] = useState('');
  const [remainingMs, setRemainingMs] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const codeInputRef = useRef(null);

  useEffect(() => {
    if (!otpState) return;
    const tick = () => setRemainingMs(new Date(otpState.expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [otpState]);

  useEffect(() => {
    if (otpState) codeInputRef.current?.focus();
  }, [otpState]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login(email, password, publicDevice);
      if (result.otpRequired) {
        setOtpState({ userId: result.userId, expiresAt: result.expiresAt });
        setCode('');
        setLockedUntil(null);
      } else {
        navigate('/');
      }
    } catch (err) {
      if (err.lockedUntil) setLockedUntil(err.lockedUntil);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e) {
    e.preventDefault();
    if (remainingMs <= 0) {
      toast('That code has expired — please log in again', 'error');
      setOtpState(null);
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(otpState.userId, code, publicDevice);
      navigate('/');
    } catch (err) {
      if (err.lockedUntil) {
        setLockedUntil(err.lockedUntil);
        setOtpState(null);
      }
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    return (
      <AuthLayout title="Login temporarily locked" subtitle="Too many incorrect codes were entered.">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center' }}>
          For your security, login is locked until <strong style={{ color: 'var(--text)' }}>{new Date(lockedUntil).toLocaleTimeString()}</strong>.
          Please try again after that.
        </p>
      </AuthLayout>
    );
  }

  if (otpState) {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a 4-digit code to ${email}.`}>
        <form onSubmit={onVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="label">Login code</label>
            <input
              ref={codeInputRef}
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              style={{ fontSize: 22, letterSpacing: 8, textAlign: 'center' }}
            />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
            {remainingMs > 0 ? (
              <>Code expires in <strong style={{ color: 'var(--text)' }}>{msToClock(remainingMs)}</strong></>
            ) : (
              <span style={{ color: 'var(--red)' }}>Code expired — go back and log in again</span>
            )}
          </p>
          <button className="btn btn-primary" disabled={busy || code.length !== 4} type="submit">
            {busy && <span className="spinner" />}
            Verify &amp; log in
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setOtpState(null)}
            style={{ fontSize: 13 }}
          >
            Back to login
          </button>
        </form>
      </AuthLayout>
    );
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={publicDevice} onChange={(e) => setPublicDevice(e.target.checked)} />
          This is a public or shared device — log me out when the window closes
        </label>
        <button className="btn btn-primary" disabled={busy} type="submit" style={{ marginTop: 8 }}>
          {busy && <span className="spinner" />}
          Log in
        </button>
      </form>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 20, textAlign: 'center' }}>
        No account yet? <Link to="/register" style={{ color: 'var(--blue)', fontWeight: 600 }}>Create one</Link>
      </p>
    </AuthLayout>
  );
}
