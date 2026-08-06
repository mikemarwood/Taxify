import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from '../components/Icon.jsx';
import { AuthSplitFrame } from '../components/AuthSplit.jsx';
import SignupArtwork from '../components/SignupArtwork.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { playClick, playError, playSuccess } from '../lib/sounds.js';
import { financialYearSpan } from '../lib/financialYear.js';

const LIMITS = {
  firstName: { max: 60 },
  lastName: { max: 60 },
  phone: { min: 6, max: 20 },
  email: { max: 254 },
  businessName: { max: 120 },
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

const STEPS = [
  { key: 'you', label: 'About you', icon: 'users' },
  { key: 'email', label: 'Your email', icon: 'mail' },
  { key: 'where', label: 'Where you are', icon: 'globe' },
  { key: 'plan', label: 'Choose a plan', icon: 'tag' },
  { key: 'finish', label: 'Finish up', icon: 'check-circle' },
];

function Field({ label, hint, error, required, children, span }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, gridColumn: span ? '1 / -1' : undefined }}>
      <label className="label" style={{ marginBottom: 0, fontSize: 12.5 }}>
        {label}
        {required && <span style={{ color: 'var(--red)' }}> *</span>}
      </label>
      {children}
      <span style={{ fontSize: 11.5, minHeight: 15, color: error ? 'var(--red)' : 'var(--text-muted)' }}>
        {error || hint || ''}
      </span>
    </div>
  );
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  const [options, setOptions] = useState(null);
  const [plans, setPlans] = useState([]);
  const [captcha, setCaptcha] = useState(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [country, setCountry] = useState('');
  // Only asked when we don't already know the country's tax year.
  const [fyMonth, setFyMonth] = useState(0);
  const [fyDay, setFyDay] = useState(1);
  const [state, setState] = useState('');
  const [currency, setCurrency] = useState('AUD');
  // Honours ?plan= from the landing page, so a plan picked there is already
  // chosen here rather than being asked for a second time. Anything unknown
  // falls back rather than leaving the step blank.
  const [planType, setPlanType] = useState(() => {
    const asked = new URLSearchParams(window.location.search).get('plan');
    return asked === 'business' || asked === 'individual' ? asked : 'individual';
  });
  const [promoCode, setPromoCode] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const [emailStatus, setEmailStatus] = useState({ state: 'idle' });
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
    }, 400);
    return () => clearTimeout(emailTimer.current);
  }, [email]);

  // What we already know about this country's tax year, if anything.
  const knownFinancialYear = useMemo(
    () => (country && options?.financialYears ? options.financialYears[country] || null : null),
    [country, options]
  );

  const statesForCountry = useMemo(() => {
    if (!options || !country) return null;
    const match = options.countries.find((c) => c.name === country);
    return match ? options.states[match.code] || null : null;
  }, [options, country]);

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
    if (dateOfBirth) {
      const years = (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (years < 16) e.dateOfBirth = 'You must be at least 16';
      if (years > 120) e.dateOfBirth = 'Check the year';
    }
    return e;
  }, [email, confirmEmail, emailStatus, phone, dateOfBirth]);

  // Each step gates its own Next, so a mistake is caught on the screen that
  // caused it rather than at the very end.
  const stepValid = [
    firstName.trim() && lastName.trim() && dateOfBirth && !errors.dateOfBirth && !errors.phone,
    email.trim() && confirmEmail.trim() && emailStatus.state === 'free' && !errors.confirmEmail,
    // The financial year has to be answered too when we do not know it —
    // otherwise the server rejects the whole registration at the last step.
    country && state.trim() && currency && (knownFinancialYear || fyMonth > 0),
    Boolean(planType),
    referralSource && termsAccepted && captchaAnswer.trim(),
  ];

  const isLast = step === STEPS.length - 1;

  function go(next) {
    playClick();
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  async function applyPromo() {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    setPromoBusy(true);
    try {
      const res = await api.post('/auth/promo/check', { code, planType });
      setPromoStatus({ ok: true, ...res.data });
      playSuccess();
    } catch (err) {
      setPromoStatus({ ok: false, reason: err.message });
    } finally {
      setPromoBusy(false);
    }
  }

  async function submit() {
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
        ...(knownFinancialYear ? {} : { financialYearStart: { month: fyMonth, day: fyDay } }),
        promoCode: promoStatus?.ok ? promoCode.trim().toUpperCase() : undefined,
        businessName: businessName.trim() || undefined,
        referralSource,
        termsAccepted,
        captchaToken: captcha?.token,
        captchaAnswer,
      });
      playSuccess();
      setPendingEmail(email.trim().toLowerCase());
    } catch (err) {
      playError();
      toast(err.message, 'error');
      newCaptcha();
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    if (busy || !stepValid[step]) return;
    if (isLast) submit();
    else go(step + 1);
  }

  if (pendingEmail) return <PendingActivation email={pendingEmail} />;

  const selectedPlan = plans.find((p) => p.planType === planType) || null;
  const trialDays = options?.trialDays || 14;

  return (
    <AuthSplitFrame>
      <form onSubmit={onSubmit} style={{ display: 'contents' }}>
        {/* Rail: where you are in the sequence, and what's still coming. */}
        <aside
          className="signup-brand"
          style={{
            position: 'relative',
            background: 'var(--nav-bg)',
            padding: '40px 40px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <img src="/logo.svg" alt="" width="34" height="34" />
            <span style={{ fontWeight: 700, fontSize: 21, color: 'var(--nav-text-active)' }}>Taxify</span>
          </div>

          <h2
            style={{
              margin: 0,
              fontSize: 'clamp(22px, 2.2vw, 29px)',
              lineHeight: 1.25,
              letterSpacing: -0.6,
              color: 'var(--nav-text-active)',
              textWrap: 'balance',
            }}
          >
            Every receipt where you left it, come tax time.
          </h2>

          <div className="signup-art" style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
            <SignupArtwork />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {STEPS.map((s, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <button
                  key={s.key}
                  type="button"
                  // Only backwards: skipping ahead past an unfinished step would
                  // land you on a Next you can't press.
                  disabled={i > step}
                  onClick={() => i < step && go(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '9px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: current ? 'var(--nav-active-bg)' : 'transparent',
                    color: current || done ? 'var(--nav-text-active)' : 'var(--nav-text)',
                    cursor: i < step ? 'pointer' : 'default',
                    textAlign: 'left',
                    fontSize: 13.5,
                    fontWeight: current ? 700 : 500,
                  }}
                >
                  <motion.span
                    animate={{
                      background: done ? 'var(--nav-accent)' : current ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)',
                      scale: current ? 1.06 : 1,
                    }}
                    transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {done ? <Icon name="check" size={13} strokeWidth={2.6} /> : <Icon name={s.icon} size={13} />}
                  </motion.span>
                  {s.label}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
              <motion.div
                animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                style={{ height: '100%', background: 'var(--nav-accent)', borderRadius: 999 }}
              />
            </div>
            <span style={{ fontSize: 12, color: 'var(--nav-text)' }}>
              Step {step + 1} of {STEPS.length}
            </span>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 4 }}>
              {[
                { icon: 'gift', label: `${trialDays}-day free trial` },
                { icon: 'lock', label: 'No card required' },
                { icon: 'shield', label: 'Cancel any time' },
              ].map((t) => (
                <span
                  key={t.label}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--nav-text)' }}
                >
                  <Icon name={t.icon} size={13} style={{ color: 'var(--nav-accent)' }} />
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </aside>

        {/* Panel: one step at a time, sliding in the direction of travel. */}
        <section
          style={{
            // Paper against the navy, so the two halves read as chrome and
            // content rather than as one flat surface.
            background: 'var(--bg-card)',
            padding: 'clamp(28px, 5vw, 56px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: direction * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -28 }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}
            >
              <h1 style={{ margin: 0, fontSize: 'clamp(22px, 2.4vw, 28px)', letterSpacing: -0.5 }}>{HEADINGS[step].title}</h1>
              <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--text-muted)' }}>{HEADINGS[step].sub}</p>

              {step === 0 && (
                <Grid>
                  <Field label="First name" required>
                    <input
                      className="input"
                      autoFocus
                      value={firstName}
                      maxLength={LIMITS.firstName.max}
                      onChange={(e) => setFirstName(toPersonName(e.target.value))}
                      autoComplete="given-name"
                    />
                  </Field>
                  <Field label="Last name" required>
                    <input
                      className="input"
                      value={lastName}
                      maxLength={LIMITS.lastName.max}
                      onChange={(e) => setLastName(toPersonName(e.target.value))}
                      autoComplete="family-name"
                    />
                  </Field>
                  <Field label="Date of birth" required error={errors.dateOfBirth} hint="dd/mm/yyyy">
                    <input
                      type="date"
                      className="input"
                      value={dateOfBirth}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      autoComplete="bday"
                    />
                  </Field>
                  <Field label="Phone number" error={errors.phone} hint="Area code then number">
                    <input
                      className="input"
                      value={phone}
                      inputMode="tel"
                      maxLength={LIMITS.phone.max}
                      placeholder="08 9123 4567"
                      onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ''))}
                      autoComplete="tel"
                    />
                  </Field>
                  <Field label="Business name" span hint="Optional — if you trade under one">
                    <input
                      className="input"
                      value={businessName}
                      maxLength={LIMITS.businessName.max}
                      onChange={(e) => setBusinessName(e.target.value)}
                      autoComplete="organization"
                    />
                  </Field>
                </Grid>
              )}

              {step === 1 && (
                <Grid>
                  <Field
                    label="Email"
                    required
                    span
                    error={errors.email}
                    hint={
                      emailStatus.state === 'checking'
                        ? 'Checking availability…'
                        : emailStatus.state === 'free'
                        ? '✓ That address is available'
                        : 'You’ll sign in with this'
                    }
                  >
                    <input
                      type="email"
                      className="input"
                      autoFocus
                      value={email}
                      maxLength={LIMITS.email.max}
                      onChange={(e) => setEmail(e.target.value.toLowerCase())}
                      autoComplete="email"
                    />
                  </Field>
                  <Field label="Confirm email" required span error={errors.confirmEmail} hint="Typed again, not pasted">
                    <input
                      type="email"
                      className="input"
                      value={confirmEmail}
                      maxLength={LIMITS.email.max}
                      onPaste={(e) => e.preventDefault()}
                      onChange={(e) => setConfirmEmail(e.target.value.toLowerCase())}
                      autoComplete="off"
                    />
                  </Field>
                  <Note span icon="mail">
                    We'll send an activation link here. Opening it is where you choose your password — we don't ask
                    for one now, so nobody can set a password on an address they don't control.
                  </Note>
                </Grid>
              )}

              {step === 2 && (
                <Grid>
                  <Field label="Country" required>
                    <select
                      className="input"
                      autoFocus
                      value={country}
                      onChange={(e) => {
                        setCountry(e.target.value);
                        setState('');
                        const match = options?.countries.find((c) => c.name === e.target.value);
                        if (match) setCurrency(match.currency);
                      }}
                    >
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
                      <select className="input" value={state} onChange={(e) => setState(e.target.value)}>
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
                        value={state}
                        maxLength={80}
                        disabled={!country}
                        placeholder={country ? 'Type your state or region' : 'Choose a country first'}
                        onChange={(e) => setState(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Preferred currency" required span hint="Used when you record an expense — set from your country">
                    <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {(options?.currencies || []).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {/* A financial year is not the same twelve months
                      everywhere, and everything here is filed into one. Where
                      we know the country's year we say so; where we don't, we
                      ask rather than guess — getting it wrong files an entire
                      history into the wrong years. */}
                  {country && (
                    <Field
                      label="Your financial year"
                      required
                      span
                      hint={
                        knownFinancialYear
                          ? 'Set from your country — this decides how everything is filed, and cannot be changed later'
                          : 'We don’t know this country’s tax year, so please tell us when yours starts'
                      }
                    >
                      {knownFinancialYear ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 9,
                            padding: '10px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--accent-soft)',
                            border: '1px solid var(--accent-ring)',
                            fontSize: 13.5,
                            fontWeight: 600,
                          }}
                        >
                          <Icon name="check-circle" size={16} style={{ color: 'var(--accent)' }} />
                          {financialYearSpan(knownFinancialYear)}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <select
                            className="input"
                            aria-label="Financial year start month"
                            style={{ flex: 1, minWidth: 150 }}
                            value={fyMonth}
                            onChange={(e) => setFyMonth(Number(e.target.value))}
                          >
                            <option value={0}>Starts in…</option>
                            {MONTH_NAMES.map((m, i) => (
                              <option key={m} value={i + 1}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input"
                            aria-label="Financial year start day"
                            style={{ width: 120 }}
                            value={fyDay}
                            onChange={(e) => setFyDay(Number(e.target.value))}
                          >
                            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={d}>
                                on the {d}
                              </option>
                            ))}
                          </select>
                          {fyMonth > 0 && (
                            <div style={{ flexBasis: '100%', fontSize: 12.5, color: 'var(--text-muted)' }}>
                              Your year will run {financialYearSpan({ startMonth: fyMonth, startDay: fyDay })}.
                            </div>
                          )}
                        </div>
                      )}
                    </Field>
                  )}
                </Grid>
              )}

              {step === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    {plans.map((plan) => (
                      <PlanCard
                        key={plan.planType}
                        plan={plan}
                        selected={planType === plan.planType}
                        discounted={promoStatus?.ok && planType === plan.planType ? promoStatus.discountedPerYear : null}
                        trialDays={trialDays}
                        onSelect={() => {
                          playClick();
                          setPlanType(plan.planType);
                        }}
                      />
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <Field label="Promo code" hint="Optional" error={promoStatus && !promoStatus.ok ? promoStatus.reason : null}>
                      <input
                        className="input"
                        style={{ textTransform: 'uppercase', width: 190 }}
                        value={promoCode}
                        maxLength={40}
                        placeholder="SPRING25"
                        onChange={(e) => {
                          setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''));
                          setPromoStatus(null);
                        }}
                      />
                    </Field>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 13, marginBottom: 20 }}
                      disabled={!promoCode.trim() || promoBusy}
                      onClick={applyPromo}
                    >
                      {promoBusy && <span className="spinner" />}
                      Apply
                    </button>
                    {promoStatus?.ok && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        style={{ fontSize: 12.5, color: 'var(--emerald)', fontWeight: 700, marginBottom: 22 }}
                      >
                        ✓ {promoStatus.promo.code} applied
                      </motion.span>
                    )}
                  </div>

                  <Note icon="check-circle">
                    <strong>No card details needed.</strong> The {trialDays}-day trial starts when you activate, and
                    nothing is charged until you choose to subscribe.
                  </Note>
                </div>
              )}

              {step === 4 && (
                <Grid>
                  <Field label="How did you hear about us?" required span>
                    <select
                      className="input"
                      autoFocus
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

                  <Field label="Quick check you're a person" required span>
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
                        value={captchaAnswer}
                        inputMode="numeric"
                        maxLength={3}
                        onChange={(e) => setCaptchaAnswer(e.target.value.replace(/\D/g, ''))}
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
                  </Field>

                  <label
                    style={{
                      gridColumn: '1 / -1',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 9,
                      fontSize: 13,
                      cursor: 'pointer',
                      padding: '11px 13px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${termsAccepted ? 'var(--accent-ring)' : 'var(--border)'}`,
                      background: termsAccepted ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      style={{ marginTop: 2 }}
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
                      . Both open in a new tab.
                    </span>
                  </label>
                </Grid>
              )}
            </motion.div>
          </AnimatePresence>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => (step === 0 ? navigate(-1) : go(step - 1))}
              disabled={busy}
            >
              {step === 0 ? 'Cancel' : 'Back'}
            </button>

            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-muted)' }}>
              {isLast ? null : (
                <>
                  Already have an account?{' '}
                  <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                    Sign in
                  </Link>
                </>
              )}
            </span>

            <motion.button
              type="submit"
              className="btn btn-primary"
              disabled={!stepValid[step] || busy}
              whileHover={stepValid[step] && !busy ? { scale: 1.02 } : undefined}
              whileTap={stepValid[step] && !busy ? { scale: 0.98 } : undefined}
              style={{ minWidth: 138 }}
            >
              {busy && <span className="spinner" />}
              {isLast ? 'Create account' : 'Next'}
              {!isLast && <Icon name="arrow-right" size={15} />}
            </motion.button>
          </div>
          </div>
        </section>
      </form>
    </AuthSplitFrame>
  );
}

const HEADINGS = [
  { title: 'Let’s start with you', sub: 'The name your records and reports will be filed under.' },
  { title: 'Where can we reach you?', sub: 'This becomes your sign-in, so it needs to be one you can open.' },
  { title: 'Where are you based?', sub: 'Sets your financial year and the currency expenses default to.' },
  { title: 'Pick a plan', sub: 'Both start with a free trial. You can change plan later.' },
  { title: 'Last thing', sub: 'Then we’ll email you a link to set your password.' },
];


function Grid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>{children}</div>;
}

function Note({ children, icon, span }) {
  return (
    <div
      style={{
        gridColumn: span ? '1 / -1' : undefined,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 9,
        padding: '11px 13px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent-ring)',
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <Icon name={icon} size={15} style={{ color: 'var(--accent)', marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

function PlanCard({ plan, selected, discounted, trialDays, onSelect }) {
  const full = money(plan.amountPerYear, plan.currency);
  const cut = discounted !== null && discounted !== undefined ? money(discounted, plan.currency) : null;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      animate={{
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
        background: selected ? 'var(--accent-soft)' : 'var(--bg-card)',
      }}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: 15,
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        borderWidth: 2,
        borderStyle: 'solid',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {selected && (
        <motion.span
          layoutId="plan-tick"
          style={{ position: 'absolute', top: 12, right: 12, color: 'var(--accent)', display: 'flex' }}
        >
          <Icon name="check-circle" size={17} />
        </motion.span>
      )}

      <span style={{ fontWeight: 700, fontSize: 15 }}>{plan.name}</span>

      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        {cut ? (
          <>
            <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>{cut}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)', textDecoration: 'line-through' }}>{full}</span>
          </>
        ) : (
          <span style={{ fontSize: 24, fontWeight: 800 }}>{full || '—'}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>per year</span>
      </span>

      <span
        style={{
          alignSelf: 'flex-start',
          fontSize: 10.5,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 999,
          color: 'var(--emerald)',
          background: 'rgba(12, 115, 67, 0.1)',
        }}
      >
        {trialDays}-day free trial
      </span>

      <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{plan.tagline}</span>

      <ul style={{ margin: 0, paddingLeft: 15, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {plan.features.slice(0, 3).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </motion.button>
  );
}

// Shown once the account exists. The resend button counts down rather than
// failing quietly, so it's clear the request was heard.
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="card"
        style={{ width: '100%', maxWidth: 480, padding: 34, textAlign: 'center' }}
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
          style={{
            width: 62,
            height: 62,
            margin: '0 auto 18px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
          }}
        >
          <Icon name="mail" size={28} />
        </motion.div>

        <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>Check your email</h1>
        <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6 }}>
          We've sent an activation link to <strong>{email}</strong>.
        </p>
        <p style={{ margin: '0 0 22px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Opening it is where you'll choose your password. The link works for 5 days — after that the account is
          removed automatically, and we'll remind you before then. Check your spam folder before resending.
        </p>

        <button className="btn btn-ghost" onClick={resend} disabled={busy || secondsLeft > 0} style={{ width: '100%' }}>
          {busy && <span className="spinner" />}
          {secondsLeft > 0 ? `Resend available in ${mm}:${ss}` : 'Resend activation email'}
        </button>

        <Link
          to="/login"
          style={{ display: 'block', marginTop: 16, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}
        >
          Back to sign in
        </Link>
      </motion.div>
    </div>
  );
}
