import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { playError } from '../lib/sounds.js';

// Mirrors the server's limits so the form can say what's wrong before a round
// trip. The server re-checks all of it — this is for the person typing.
const LIMITS = {
  firstName: { min: 1, max: 60 },
  lastName: { min: 1, max: 60 },
  phone: { min: 6, max: 20 },
  email: { max: 254 },
  businessName: { min: 2, max: 120 },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// "mike o'BRIEN" -> "Mike O'Brien", applied as they type so the field shows
// what will actually be stored rather than correcting it quietly on save.
function toPersonName(raw) {
  return String(raw)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function money(cents, currency) {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function Field({ label, hint, error, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label className="label" style={{ marginBottom: 0 }}>
        {label}
        {required && <span style={{ color: 'var(--red)' }}> *</span>}
      </label>
      {children}
      {error ? (
        <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{hint}</span>
      ) : null}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <legend
        style={{
          padding: 0,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.7,
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [options, setOptions] = useState(null);
  const [plans, setPlans] = useState([]);
  const [captcha, setCaptcha] = useState(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [planType, setPlanType] = useState('individual');
  const [promoCode, setPromoCode] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const [emailStatus, setEmailStatus] = useState({ state: 'idle' }); // idle | checking | free | taken | invalid
  const [promoStatus, setPromoStatus] = useState(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(null);

  const emailTimer = useRef(null);

  const newCaptcha = useCallback(() => {
    api
      .get('/auth/captcha')
      .then((res) => {
        setCaptcha(res.data);
        setCaptchaAnswer('');
      })
      .catch(() => setCaptcha(null));
  }, []);

  useEffect(() => {
    api
      .get('/auth/signup-options')
      .then((res) => {
        setOptions(res.data);
        setCountry(res.data.detectedCountry);
        const match = res.data.countries.find((c) => c.name === res.data.detectedCountry);
        if (match) setCurrency(match.currency);
      })
      .catch(() => setOptions({ countries: [], states: {}, currencies: [], referralSources: [] }));

    api.get('/auth/plans').then((res) => setPlans(res.data.plans)).catch(() => setPlans([]));
    newCaptcha();
  }, [newCaptcha]);

  // Checked as they type, debounced — finding out an address is taken after
  // filling in a dozen fields is the worst possible moment.
  useEffect(() => {
    clearTimeout(emailTimer.current);
    const value = email.trim().toLowerCase();
    if (!value) {
      setEmailStatus({ state: 'idle' });
      return undefined;
    }
    if (!EMAIL_PATTERN.test(value)) {
      setEmailStatus({ state: 'invalid' });
      return undefined;
    }

    setEmailStatus({ state: 'checking' });
    emailTimer.current = setTimeout(() => {
      api
        .get(`/auth/email-available?email=${encodeURIComponent(value)}`)
        .then((res) => setEmailStatus({ state: res.data.available ? 'free' : 'taken', reason: res.data.reason }))
        .catch(() => setEmailStatus({ state: 'idle' }));
    }, 450);
    return () => clearTimeout(emailTimer.current);
  }, [email]);

  const statesForCountry = useMemo(() => {
    if (!options || !country) return null;
    const match = options.countries.find((c) => c.name === country);
    return match ? options.states[match.code] || null : null;
  }, [options, country]);

  function onCountryChange(next) {
    setCountry(next);
    setState('');
    const match = options?.countries.find((c) => c.name === next);
    if (match) setCurrency(match.currency);
  }

  const selectedPlan = plans.find((p) => p.planType === planType) || null;

  async function applyPromo() {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    setPromoBusy(true);
    try {
      const res = await api.post('/auth/promo/check', { code, planType });
      setPromoStatus({ ok: true, ...res.data });
    } catch (err) {
      setPromoStatus({ ok: false, reason: err.message });
    } finally {
      setPromoBusy(false);
    }
  }

  // A code can be tied to one plan, so switching plans clears a discount that
  // may no longer apply rather than showing a price that won't be honoured.
  useEffect(() => {
    setPromoStatus(null);
  }, [planType]);

  const errors = useMemo(() => {
    const e = {};
    if (email && emailStatus.state === 'invalid') e.email = 'That doesn’t look like an email address';
    if (emailStatus.state === 'taken') e.email = emailStatus.reason;
    if (confirmEmail && confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      e.confirmEmail = 'The two addresses don’t match';
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length > 0 && digits.length < LIMITS.phone.min) e.phone = 'That looks too short';
    if (businessName.trim().length === 1) e.businessName = 'Too short';
    if (dateOfBirth) {
      const years = (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (years < 16) e.dateOfBirth = 'You must be at least 16';
      if (years > 120) e.dateOfBirth = 'Check the year';
    }
    return e;
  }, [email, confirmEmail, emailStatus, phone, businessName, dateOfBirth]);

  const complete =
    firstName.trim() &&
    lastName.trim() &&
    dateOfBirth &&
    email.trim() &&
    confirmEmail.trim() &&
    currency &&
    country &&
    state.trim() &&
    planType &&
    referralSource &&
    termsAccepted &&
    captchaAnswer.trim() &&
    emailStatus.state === 'free' &&
    Object.keys(errors).length === 0;

  async function onSubmit(event) {
    event.preventDefault();
    if (!complete || busy) return;

    setBusy(true);
    try {
      await register({
        firstName,
        lastName,
        dateOfBirth,
        phone,
        email,
        confirmEmail,
        currency,
        country,
        state,
        planType,
        promoCode: promoStatus?.ok ? promoCode.trim().toUpperCase() : undefined,
        businessName: businessName.trim() || undefined,
        referralSource,
        termsAccepted,
        captchaToken: captcha?.token,
        captchaAnswer,
      });
      setPendingEmail(email.trim().toLowerCase());
    } catch (err) {
      playError();
      toast(err.message, 'error');
      newCaptcha(); // a challenge is spent once submitted, right or wrong
    } finally {
      setBusy(false);
    }
  }

  if (pendingEmail) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step before you can sign in.">
        <PendingActivation email={pendingEmail} />
      </AuthLayout>
    );
  }

  const inputStyle = { fontSize: 13.5 };
  const trialDays = options?.trialDays || 14;

  return (
    <AuthLayout title="Create your account" subtitle={`A ${trialDays}-day trial, no card details required.`}>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Section title="About you">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="First name" required>
              <input
                className="input"
                style={inputStyle}
                value={firstName}
                maxLength={LIMITS.firstName.max}
                onChange={(e) => setFirstName(toPersonName(e.target.value))}
                autoComplete="given-name"
              />
            </Field>
            <Field label="Last name" required>
              <input
                className="input"
                style={inputStyle}
                value={lastName}
                maxLength={LIMITS.lastName.max}
                onChange={(e) => setLastName(toPersonName(e.target.value))}
                autoComplete="family-name"
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Date of birth" required error={errors.dateOfBirth} hint="dd/mm/yyyy">
              <input
                type="date"
                className="input"
                style={inputStyle}
                value={dateOfBirth}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDateOfBirth(e.target.value)}
                autoComplete="bday"
              />
            </Field>
            <Field label="Phone number" error={errors.phone} hint="Area code then number">
              <input
                className="input"
                style={inputStyle}
                value={phone}
                inputMode="tel"
                maxLength={LIMITS.phone.max}
                placeholder="08 9123 4567"
                // Digits and the punctuation people write around them; letters
                // are dropped as they type rather than rejected on submit.
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ''))}
                autoComplete="tel"
              />
            </Field>
          </div>

          <Field label="Business name" hint="Optional — if you trade under one" error={errors.businessName}>
            <input
              className="input"
              style={inputStyle}
              value={businessName}
              maxLength={LIMITS.businessName.max}
              onChange={(e) => setBusinessName(e.target.value)}
              autoComplete="organization"
            />
          </Field>
        </Section>

        <Section title="Email address">
          <Field
            label="Email"
            required
            error={errors.email}
            hint={
              emailStatus.state === 'checking'
                ? 'Checking…'
                : emailStatus.state === 'free'
                ? '✓ Available'
                : 'You’ll sign in with this'
            }
          >
            <input
              type="email"
              className="input"
              style={inputStyle}
              value={email}
              maxLength={LIMITS.email.max}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
              autoComplete="email"
            />
          </Field>
          <Field label="Confirm email" required error={errors.confirmEmail}>
            <input
              type="email"
              className="input"
              style={inputStyle}
              value={confirmEmail}
              maxLength={LIMITS.email.max}
              // Pasting defeats the point of asking twice.
              onPaste={(e) => e.preventDefault()}
              onChange={(e) => setConfirmEmail(e.target.value.toLowerCase())}
              autoComplete="off"
            />
          </Field>
        </Section>

        <Section title="Where you are">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Country" required>
              <select className="input" style={inputStyle} value={country} onChange={(e) => onCountryChange(e.target.value)}>
                <option value="">Choose…</option>
                {(options?.countries || []).map((c) => (
                  <option key={c.code} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={statesForCountry ? 'State' : 'State or region'} required>
              {statesForCountry ? (
                <select className="input" style={inputStyle} value={state} onChange={(e) => setState(e.target.value)}>
                  <option value="">Choose…</option>
                  {statesForCountry.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  style={inputStyle}
                  value={state}
                  maxLength={80}
                  disabled={!country}
                  placeholder={country ? 'Type your state or region' : 'Choose a country first'}
                  onChange={(e) => setState(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Preferred currency" required hint="Used when you record an expense">
            <select className="input" style={inputStyle} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(options?.currencies || []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Choose a plan">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.planType}
                plan={plan}
                selected={planType === plan.planType}
                discounted={promoStatus?.ok && planType === plan.planType ? promoStatus.discountedPerYear : null}
                trialDays={trialDays}
                onSelect={() => setPlanType(plan.planType)}
              />
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-ring)',
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            <Icon name="check-circle" size={15} style={{ color: 'var(--accent)', marginTop: 1 }} />
            <span>
              <strong>No card details needed.</strong> The {trialDays}-day trial starts when you activate, and
              nothing is charged until you choose to subscribe.
            </span>
          </div>

          <Field
            label="Promo code"
            hint={promoStatus?.ok ? null : 'Optional'}
            error={promoStatus && !promoStatus.ok ? promoStatus.reason : null}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ ...inputStyle, textTransform: 'uppercase' }}
                value={promoCode}
                maxLength={40}
                placeholder="SPRING25"
                onChange={(e) => {
                  setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''));
                  setPromoStatus(null);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 13 }}
                disabled={!promoCode.trim() || promoBusy}
                onClick={applyPromo}
              >
                {promoBusy && <span className="spinner" />}
                Apply
              </button>
            </div>
          </Field>
          {promoStatus?.ok && (
            <div style={{ fontSize: 12.5, color: 'var(--emerald)', fontWeight: 600 }}>
              ✓ {promoStatus.promo.code} applied
              {promoStatus.discountedPerYear !== null &&
                ` — ${money(promoStatus.discountedPerYear, selectedPlan?.currency)} for the first year`}
            </div>
          )}
        </Section>

        <Section title="Finishing up">
          <Field label="How did you hear about us?" required>
            <select
              className="input"
              style={inputStyle}
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
            >
              <option value="">Choose…</option>
              {(options?.referralSources || []).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Verification" required hint="A quick check that you're a person">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  fontFamily: 'Consolas, monospace',
                  fontSize: 17,
                  fontWeight: 700,
                  padding: '7px 14px',
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
                style={{ ...inputStyle, width: 90 }}
                value={captchaAnswer}
                inputMode="numeric"
                maxLength={3}
                onChange={(e) => setCaptchaAnswer(e.target.value.replace(/\D/g, ''))}
              />
              <button
                type="button"
                title="Give me a different sum"
                className="btn btn-ghost"
                style={{ fontSize: 12.5, padding: '7px 10px' }}
                onClick={newCaptcha}
              >
                <Icon name="repeat" size={14} />
              </button>
            </div>
          </Field>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              I agree to the{' '}
              <a href="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                Privacy Policy
              </a>
              .
            </span>
          </label>
        </Section>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={!complete || busy} style={{ flex: 1 }}>
            {busy && <span className="spinner" />}
            Create account
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)} disabled={busy}>
            Cancel
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

function PlanCard({ plan, selected, discounted, trialDays, onSelect }) {
  const full = money(plan.amountPerYear, plan.currency);
  const cut = discounted !== null && discounted !== undefined ? money(discounted, plan.currency) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: 'left',
        padding: 16,
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        background: selected ? 'var(--accent-soft)' : 'var(--bg-card)',
        border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon
          name={selected ? 'check-circle' : 'tag'}
          size={16}
          style={{ color: selected ? 'var(--accent)' : 'var(--text-muted)' }}
        />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{plan.name}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
        {cut ? (
          <>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>{cut}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'line-through' }}>{full}</span>
          </>
        ) : (
          <span style={{ fontSize: 22, fontWeight: 800 }}>{full || '—'}</span>
        )}
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>per year</span>
      </div>

      <span
        style={{
          alignSelf: 'flex-start',
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 999,
          color: 'var(--emerald)',
          background: 'rgba(12, 115, 67, 0.1)',
        }}
      >
        {trialDays}-day free trial
      </span>

      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{plan.tagline}</span>

      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        {plan.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </button>
  );
}

// Shown after signing up. The resend button counts down rather than failing
// quietly, so it's clear the request was heard and when it can be repeated.
function PendingActivation({ email }) {
  const { resendActivation } = useAuth();
  const toast = useToast();
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  async function resend() {
    setBusy(true);
    try {
      const wait = await resendActivation(email);
      setSecondsLeft(wait);
      toast('Activation email sent — check your inbox and spam folder', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent)' }}>
        <Icon name="mail" size={34} />
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
        We've sent an activation link to <strong>{email}</strong>. Opening it is where you'll choose your password —
        we didn't ask for one here so nobody can set a password on an address they don't control.
      </p>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        The link is good for 5 days. If it isn't used the account is removed automatically, and we'll remind you
        before that happens. Check your spam folder before resending.
      </p>

      <button className="btn btn-ghost" onClick={resend} disabled={busy || secondsLeft > 0}>
        {busy && <span className="spinner" />}
        {secondsLeft > 0 ? `Resend available in ${mm}:${ss}` : 'Resend activation email'}
      </button>

      <Link to="/login" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textAlign: 'center' }}>
        Back to sign in
      </Link>
    </div>
  );
}
