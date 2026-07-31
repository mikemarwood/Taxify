import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { onDigitKeyDown } from '../lib/sounds.js';
import { api } from '../lib/api.js';
import Toggle from '../components/Toggle.jsx';

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
  const [lockRemainingMs, setLockRemainingMs] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const attemptedRef = useRef(null);
  const codeInputRef = useRef(null);

  // Counted down from the duration the server sent, not from the difference
  // between its clock and this one. A server running a few minutes behind used
  // to make a code that had just been issued read as already expired.
  useEffect(() => {
    if (!otpState) return undefined;
    const deadline = Date.now() + (otpState.expiresInSeconds ?? 300) * 1000;
    const tick = () => setRemainingMs(deadline - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [otpState]);

  useEffect(() => {
    if (!lockedUntil) return undefined;
    const deadline = Date.now() + (lockSeconds ?? 0) * 1000;
    const tick = () => setLockRemainingMs(deadline - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, lockSeconds]);

  // The first code counts as a send, so the resend button starts on cooldown
  // rather than inviting an immediate second one.
  useEffect(() => {
    if (otpState) setResendIn(300);
  }, [otpState?.userId]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  useEffect(() => {
    if (otpState) codeInputRef.current?.focus();
  }, [otpState]);

  function lockAccount(until, seconds) {
    setLockedUntil(until);
    setLockSeconds(seconds ?? 0);
    setLockRemainingMs((seconds ?? 0) * 1000);
  }

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
      if (err.lockedUntil) lockAccount(err.lockedUntil, err.lockedForSeconds);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value) {
    if (remainingMs <= 0) {
      toast('That code has expired — send a new one', 'error');
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(otpState.userId, value, publicDevice);
      navigate('/');
    } catch (err) {
      if (err.lockedUntil) {
        lockAccount(err.lockedUntil, err.lockedForSeconds);
        setOtpState(null);
      }
      // A rejected code is cleared so the next attempt starts from an empty
      // box — otherwise auto-submit would fire again on the same wrong digits.
      setCode('');
      attemptedRef.current = null;
      codeInputRef.current?.focus();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function onVerify(e) {
    e.preventDefault();
    if (code.length === 4) submitCode(code);
  }

  // Four digits is the whole code, so there's nothing left to decide — waiting
  // for a button press is a step that only exists because the form has one.
  // The ref stops a re-render from submitting the same digits twice.
  function onCodeChange(next) {
    const digits = next.replace(/\D/g, '').slice(0, 4);
    setCode(digits);
    if (digits.length === 4 && !busy && attemptedRef.current !== digits) {
      attemptedRef.current = digits;
      submitCode(digits);
    }
  }

  async function onResend() {
    setResending(true);
    try {
      const res = await api.post('/auth/otp/resend', { userId: otpState.userId });
      setOtpState({ ...otpState, expiresInSeconds: res.data.expiresInSeconds });
      setResendIn(res.data.retryAfterSeconds ?? 300);
      setCode('');
      attemptedRef.current = null;
      toast('A new code is on its way', 'success');
    } catch (err) {
      if (err.retryAfterSeconds) setResendIn(err.retryAfterSeconds);
      toast(err.message, 'error');
    } finally {
      setResending(false);
    }
  }

  if (lockedUntil && lockRemainingMs > 0) {
    return (
      <AuthLayout title="Login temporarily locked" subtitle="Too many incorrect codes were entered.">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center' }}>
          For your security, login is locked for another{' '}
          <strong style={{ color: 'var(--text)' }}>{msToClock(lockRemainingMs)}</strong>. Please try again after that.
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
              autoComplete="one-time-code"
              disabled={busy}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              onKeyDown={onDigitKeyDown}
              style={{ fontSize: 22, letterSpacing: 8, textAlign: 'center' }}
            />
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
            {busy ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" style={{ color: 'var(--text-muted)' }} />
                Checking your code…
              </span>
            ) : remainingMs > 0 ? (
              <>
                Signs you in as soon as all four digits are in · expires in{' '}
                <strong style={{ color: 'var(--text)' }}>{msToClock(remainingMs)}</strong>
              </>
            ) : (
              <span style={{ color: 'var(--red)' }}>That code has expired — send a new one below</span>
            )}
          </p>

          <button
            type="button"
            className="btn btn-ghost"
            disabled={resending || resendIn > 0}
            onClick={onResend}
          >
            {resending && <span className="spinner" />}
            {resendIn > 0 ? `Resend available in ${msToClock(resendIn * 1000)}` : 'Send a new code'}
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
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <label className="label">Password</label>
            <Link to="/forgot-password" style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 }}>
              Forgot password?
            </Link>
          </div>
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Toggle
          checked={publicDevice}
          onChange={setPublicDevice}
          label="This is a public or shared device — log me out when the window closes"
        />
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
