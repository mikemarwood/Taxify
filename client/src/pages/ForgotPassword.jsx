import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { playError, playSuccess } from '../lib/sounds.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ForgotPassword() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const newCaptcha = useCallback(() => {
    api
      .get('/auth/captcha')
      .then((res) => {
        setCaptcha(res.data);
        setAnswer('');
      })
      .catch(() => setCaptcha(null));
  }, []);

  useEffect(newCaptcha, [newCaptcha]);

  const [captchaError, setCaptchaError] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setCaptchaError('');
    try {
      await api.post('/auth/forgot-password', {
        email,
        captchaToken: captcha?.token,
        captchaAnswer: answer,
      });
      playSuccess();
      setSent(true);
    } catch (err) {
      playError();
      // A wrong sum belongs under the sum. A toast in the opposite corner of
      // the screen is the one place nobody is looking after typing a number
      // into a box.
      if (err.field === 'captcha') setCaptchaError(err.message);
      else toast(err.message, 'error');
      newCaptcha(); // a challenge is spent once submitted, right or wrong
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email" subtitle="If that account exists, a reset link is on its way.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent)' }}>
            <Icon name="mail" size={34} />
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            We've sent a link to <strong>{email.trim().toLowerCase()}</strong> if there's an account on it. Open the
            link to choose a new password.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            The link works for 24 hours and can only be used once. Check your spam folder before trying again —
            and note we send the same reply either way, so this page never reveals whether an address is
            registered.
          </p>
          <Link to="/login" className="btn btn-primary" style={{ textAlign: 'center' }}>
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  const complete = EMAIL_PATTERN.test(email.trim().toLowerCase()) && answer.trim();

  return (
    <AuthLayout title="Forgot your password?" subtitle="We'll email you a link to set a new one.">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label">Email address</label>
          <input
            className="input"
            type="email"
            required
            autoFocus
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value.toLowerCase())}
            autoComplete="email"
          />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>The address you sign in with</span>
        </div>

        <div>
          <label className="label">Quick check you're a person</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontFamily: 'Consolas, monospace',
                fontSize: 17,
                fontWeight: 700,
                padding: '8px 15px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border)',
                letterSpacing: 1,
                userSelect: 'none',
              }}
            >
              {captcha ? `${captcha.question} =` : '…'}
            </span>
            <input
              className="input"
              style={{ width: 88 }}
              value={answer}
              inputMode="numeric"
              maxLength={3}
              onChange={(e) => setAnswer(e.target.value.replace(/\D/g, ''))}
            />
            <button
              type="button"
              title="Give me a different sum"
              className="btn btn-ghost"
              style={{ padding: '8px 11px' }}
              onClick={newCaptcha}
            >
              <Icon name="repeat" size={14} />
            </button>
          </div>
          {captchaError && (
            <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 6 }}>
              {captchaError}
            </div>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={!complete || busy}>
          {busy && <span className="spinner" />}
          Send reset link
        </button>

        <Link to="/login" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textAlign: 'center' }}>
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  );
}
