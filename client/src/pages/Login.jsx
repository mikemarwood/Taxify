import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { autoFocusFields } from '../lib/device.js';
import { useToast } from '../components/Toast.jsx';
import { onDigitKeyDown } from '../lib/sounds.js';
import { api } from '../lib/api.js';
import Toggle from '../components/Toggle.jsx';
import Icon from '../components/Icon.jsx';
import { homePathFor } from '../lib/home.js';
import AndroidDownloadButton from '../components/AndroidDownloadButton.jsx';

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
  const [signInError, setSignInError] = useState('');

  // { userId, deadline } — deadline is an absolute timestamp fixed when the
  // code was issued, never recomputed. See the effect below for why.
  const [otpState, setOtpState] = useState(null);
  // Stamped once, at the moment the server says a code is live. The fallback
  // matches OTP_TTL_MINUTES on the server and applies only if the field is
  // missing altogether.
  const deadlineFrom = (seconds) => Date.now() + (Number(seconds) > 0 ? Number(seconds) : 300) * 1000;
  const [code, setCode] = useState('');
  const [remainingMs, setRemainingMs] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [lockRemainingMs, setLockRemainingMs] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const attemptedRef = useRef(null);
  const codeInputRef = useRef(null);

  // The deadline is worked out once, where the code is issued, and carried in
  // otpState — this effect only reads it. Computing it here meant every re-run
  // handed out a fresh five minutes: close an iPad and come back and a code
  // that had long since expired was counting down from full again, and typing
  // it in produced a rejection the screen had just implied was impossible.
  //
  // Still the server's *duration* rather than its absolute expiry, because a
  // server a few minutes behind used to make a brand-new code read as expired.
  useEffect(() => {
    if (!otpState?.deadline) return undefined;
    const tick = () => setRemainingMs(otpState.deadline - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    // A backgrounded tab stops firing intervals, so coming back re-reads the
    // clock immediately rather than showing a stale number for up to a second.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [otpState?.deadline]);

  useEffect(() => {
    if (!lockedUntil) return undefined;
    const deadline = Date.now() + (lockSeconds ?? 0) * 1000;
    const tick = () => setLockRemainingMs(deadline - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, lockSeconds]);

  // The first code counts as a send, so the resend button starts on cooldown
  // rather than inviting an immediate second one. Keyed on the deadline, not
  // the user id — the id does not change when a code is resent.
  useEffect(() => {
    if (otpState?.deadline) setResendIn(300);
  }, [otpState?.deadline]);

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
    setSignInError('');
    try {
      const result = await login(email, password, publicDevice);
      if (result.otpRequired) {
        setOtpState({ userId: result.userId, deadline: deadlineFrom(result.expiresInSeconds) });
        setCode('');
        setLockedUntil(null);
      } else {
        navigate(homePathFor(result.user));
      }
    } catch (err) {
      if (err.lockedUntil) lockAccount(err.lockedUntil, err.lockedForSeconds);
      // On the form, not in a toast. A wrong password is about the two fields
      // directly above it, and a message that appears in the far corner and
      // then removes itself is the one somebody misses — especially on a phone,
      // where it can be behind the keyboard.
      setSignInError(err.message);
      // Kept, since the attempts-remaining warning is worth saying twice.
      if (err.attemptsRemaining !== undefined) toast(err.message, 'error');
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
      const user = await verifyOtp(otpState.userId, value, publicDevice);
      navigate(homePathFor(user));
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
      setOtpState({ ...otpState, deadline: deadlineFrom(res.data.expiresInSeconds) });
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
            {/* No second clock. The line above already counts the same five
                minutes down, and two of them side by side read as the page
                being confused rather than as two different facts. */}
            Send a new code
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
        {signInError && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text)',
            }}
          >
            <Icon name="alert" size={16} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
            <span>{signInError}</span>
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            required
            // Desktop only. On a phone this summons the keyboard before anybody
            // has decided to type, covering half the screen — which is why the
            // check is shared rather than written out here.
            autoFocus={autoFocusFields}
            value={email}
            onChange={(e) => {
              setSignInError('');
              setEmail(e.target.value.toLowerCase());
            }}
          />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <label className="label">Password</label>
            <Link to="/forgot-password" style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 }}>
              Forgot password?
            </Link>
          </div>
          <input className="input" type="password" required value={password} onChange={(e) => {
                setSignInError('');
                setPassword(e.target.value);
              }} />
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

      {/* Reachable without signing in, deliberately: somebody stuck on this
          page is the person most likely to need support and the least able to
          reach it from inside the app. */}
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
        Locked out, or something wrong?{' '}
        <Link to="/support" style={{ color: 'var(--blue)', fontWeight: 600 }}>
          Contact support
        </Link>
      </p>

      {/* Also here, not only on the brand rail — the rail is hidden on a phone,
          which is the one device the app actually installs on. */}
      <div
        style={{
          marginTop: 26,
          paddingTop: 22,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center' }}>
          Log expenses on the move — snap a receipt the moment you get it
        </span>
        <AndroidDownloadButton />
      </div>
    </AuthLayout>
  );
}
