import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AndroidDownloadButton from '../components/AndroidDownloadButton.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';

// Said as what it does for you, not what it is. Each one is something people
// actually lose time or money on.
const FEATURES = [
  {
    icon: 'receipt',
    title: 'Photograph it and forget it',
    text: 'Snap a receipt on your phone and Taxify files it — right year, right category, named so you can find it again. The shoebox stays empty.',
  },
  {
    icon: 'folder',
    title: 'Filed by financial year, automatically',
    text: 'Every expense lands in the right tax year on its own — using your country’s year, whether that starts in July, April or January.',
  },
  {
    icon: 'tag',
    title: 'Categories that carry forward',
    text: 'Start with a full set of deduction categories. Each new year opens with last year’s set, so you never retype them.',
  },
  {
    icon: 'repeat',
    title: 'Recurring bills log themselves',
    text: 'Mark a bill weekly, monthly, quarterly or yearly once, and every occurrence after that is added for you.',
  },
  {
    icon: 'chart',
    title: 'Know where the money actually went',
    text: 'Category by category, year against year, with each one’s share of your total — before your accountant has to ask.',
  },
  {
    icon: 'download',
    title: 'Hand over the whole year in one file',
    text: 'One click gives you a zip: a summary spreadsheet, a PDF, and every receipt in folders — each one linked from the sheet.',
  },
  {
    icon: 'briefcase',
    title: 'Give your accountant a look, not the keys',
    text: 'Read-only access, limited to the years you choose, that expires by itself 24 hours after they first open your books.',
  },
  {
    icon: 'home',
    title: 'Built for property investors',
    text: 'Mark a category as a rental and keep agent statements, depreciation schedules and end-of-year summaries against the property itself.',
  },
  {
    icon: 'cash',
    title: 'Close the year properly',
    text: 'Record what came back and the year locks, so nothing can change what was claimed after the return was assessed.',
  },
  {
    icon: 'mail',
    title: 'A nudge, not a nag',
    text: 'One reminder to book your tax appointment, and one the day before it. That is genuinely all — we count.',
  },
  {
    icon: 'users',
    title: 'Share it with your partner',
    text: 'The Family plan adds a second full login. Same expenses, same receipts, two people keeping them up to date.',
  },
  {
    icon: 'lock',
    title: 'Your records, kept properly',
    text: 'Passwords hashed, a code emailed at every sign-in, and receipts only ever served back to the account that owns them.',
  },
];

const PLANS = [
  {
    name: 'Individual',
    planType: 'individual',
    price: '$49',
    period: '/year',
    text: 'Everything you need to track your own deductions, year round.',
    features: ['1 user account', 'Unlimited expenses & receipts', 'Full reports & search', 'Optional read-only accountant access'],
    highlight: false,
  },
  {
    name: 'Family',
    planType: 'family',
    price: '$79',
    period: '/year',
    text: 'The same full feature set, shared across two people.',
    features: ['Account holder + 1 extra full user', 'Each person tracks their own expenses', 'Optional read-only accountant access', 'Manage both users from one place'],
    highlight: true,
  },
];

const STEPS = [
  { number: '01', title: 'Log an expense', text: 'Add the amount, date, and category in seconds — attach a receipt if you have one.' },
  { number: '02', title: 'Let it organise itself', text: 'Taxify sorts everything by category and financial year automatically as you go.' },
  { number: '03', title: 'Export at tax time', text: 'Open Reports for a category-by-category, year-by-year breakdown ready to hand to your accountant.' },
];

function FeatureCard({ icon, title, text, index }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.05, ease: 'easeOut' }}
      style={{ padding: 24 }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          color: 'var(--violet)',
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent-ring)',
        }}
      >
        <Icon name={icon} size={20} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{text}</div>
    </motion.div>
  );
}

export default function Landing() {
  // Prices come from Stripe rather than being typed here, so what is advertised
  // is what will actually be charged. The hard-coded PLANS below are only the
  // shape and the wording — they are the fallback if the call fails, which is
  // better than a pricing section that renders empty.
  const [livePlans, setLivePlans] = useState(null);
  // Picking a plan here carries through to signup, so the same decision is not
  // asked for twice. Clicking the chosen one again clears it — a choice you
  // cannot undo is a trap.
  const [chosenPlan, setChosenPlan] = useState(null);
  const [trialDays, setTrialDays] = useState(14);

  useEffect(() => {
    api
      .get('/auth/plans')
      .then((res) => {
        if (res.data.plans?.length) setLivePlans(res.data.plans);
        if (res.data.trialDays) setTrialDays(res.data.trialDays);
      })
      .catch(() => {});
  }, []);

  const plans = livePlans
    ? livePlans.map((plan) => {
        const fallback = PLANS.find((f) => f.name.toLowerCase() === plan.planType) || PLANS[0];
        return {
          name: plan.name,
          // The link to signup is keyed on this, not on the display name — an
          // administrator renaming a plan must not break the handover.
          planType: plan.planType,
          price:
            plan.amountPerYear === null || plan.amountPerYear === undefined
              ? fallback.price
              : new Intl.NumberFormat(undefined, {
                  style: 'currency',
                  currency: plan.currency || 'AUD',
                  minimumFractionDigits: plan.amountPerYear % 100 === 0 ? 0 : 2,
                }).format(plan.amountPerYear / 100),
          period: '/year',
          text: plan.tagline || fallback.text,
          features: plan.features?.length ? plan.features : fallback.features,
          highlight: plan.planType === 'family',
        };
      })
    : PLANS;

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px clamp(20px, 5vw, 64px)',
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.svg" alt="Taxify" width="32" height="32" />
          <span style={{ fontWeight: 800, fontSize: 20 }}>Taxify</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link to="/login" className="btn btn-ghost">
            Log in
          </Link>
          <Link to="/register" className="btn btn-primary">
            Sign up free
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '0 clamp(20px, 5vw, 64px) 80px' }}>
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ textAlign: 'center', padding: 'clamp(40px, 8vw, 96px) 0 clamp(32px, 6vw, 56px)' }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              fontSize: 12.5,
              color: 'var(--text-muted)',
              marginBottom: 24,
            }}
          >
            Built for freelancers, tradies &amp; small business owners
          </div>
          <h1
            style={{
              fontSize: 'clamp(32px, 6vw, 52px)',
              lineHeight: 1.15,
              margin: '0 0 20px',
              fontWeight: 800,
              maxWidth: 780,
              marginInline: 'auto',
            }}
          >
            Track every tax deduction, without the spreadsheet.
          </h1>
          <p
            style={{
              fontSize: 'clamp(15px, 2vw, 18px)',
              color: 'var(--text-muted)',
              maxWidth: 600,
              margin: '0 auto 36px',
              lineHeight: 1.6,
            }}
          >
            Taxify logs your expenses, sorts them into categories, and builds year-over-year reports — so tax time
            takes minutes, not weekends.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/register" className="btn btn-primary" style={{ padding: '13px 28px', fontSize: 15 }}>
              Get started — it's free
            </Link>
            <Link to="/login" className="btn btn-ghost" style={{ padding: '13px 28px', fontSize: 15 }}>
              I already have an account
            </Link>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 18 }}>
            {trialDays}-day free trial · No credit card required
          </p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="card"
          style={{
            padding: '28px clamp(20px, 4vw, 40px)',
            marginBottom: 'clamp(48px, 8vw, 88px)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 20,
            textAlign: 'center',
          }}
        >
          {[
            ['14-day', 'Free trial, no card required'],
            ['2', 'Plans — Individual or Family'],
            ['bcrypt', 'Password hashing'],
            ['2FA', 'Email login codes'],
          ].map(([stat, label]) => (
            <div key={label}>
              <div style={{ fontSize: 24, fontWeight: 800, background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {stat}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </motion.section>

        <section style={{ marginBottom: 'clamp(48px, 8vw, 88px)' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 'clamp(24px, 4vw, 32px)', margin: '0 0 12px', fontWeight: 800 }}>
              Everything you need to stay on top of deductions
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, maxWidth: 520, margin: '0 auto' }}>
              No accounting degree required — just log as you go and let Taxify do the sorting.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} index={i} {...f} />
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 'clamp(48px, 8vw, 88px)' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 'clamp(24px, 4vw, 32px)', margin: '0 0 12px', fontWeight: 800 }}>
              From receipt to report in three steps
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            {STEPS.map((s, i) => (
              <motion.div
                key={s.number}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.35, delay: i * 0.08, ease: 'easeOut' }}
                style={{ padding: '0 8px' }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: 'transparent',
                    background: 'var(--gradient-brand)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    marginBottom: 10,
                  }}
                >
                  STEP {s.number}
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{s.text}</div>
              </motion.div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 'clamp(48px, 8vw, 88px)' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 'clamp(24px, 4vw, 32px)', margin: '0 0 12px', fontWeight: 800 }}>
              Simple, honest pricing
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, maxWidth: 520, margin: '0 auto' }}>
              Every plan starts with the same {trialDays}-day free trial. No card needed to begin, and billing is once a year — no surprises.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, maxWidth: 640, margin: '0 auto' }}>
            {plans.map((p, i) => (
              <motion.button
                key={p.name}
                type="button"
                className="card"
                aria-pressed={chosenPlan === p.name}
                onClick={() => setChosenPlan((current) => (current === p.name ? null : p.name))}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.35, delay: i * 0.08, ease: 'easeOut' }}
                whileHover={{ y: -2 }}
                style={{
                  padding: 28,
                  border:
                    chosenPlan === p.name || p.highlight ? '1px solid var(--violet)' : '1px solid var(--border)',
                  boxShadow:
                    chosenPlan === p.name
                      ? '0 0 0 2px var(--violet)'
                      : p.highlight
                        ? '0 0 0 1px var(--violet)'
                        : undefined,
                  // Dimming the one not picked is what makes this read as a
                  // choice rather than two cards that happen to differ.
                  opacity: chosenPlan && chosenPlan !== p.name ? 0.62 : 1,
                  position: 'relative',
                  font: 'inherit',
                  color: 'inherit',
                  textAlign: 'left',
                  width: '100%',
                  cursor: 'pointer',
                }}
              >
                {p.highlight && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -12,
                      left: 24,
                      background: 'var(--gradient-brand)',
                      color: 'white',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 12px',
                      borderRadius: 999,
                    }}
                  >
                    MOST POPULAR
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                <div style={{ margin: '10px 0 4px' }}>
                  <span style={{ fontSize: 32, fontWeight: 800 }}>{p.price}</span>
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{p.period}</span>
                </div>
                {/* On every card, not only in the line above them. Somebody
                    comparing two prices is looking at the cards, and "does this
                    one have a trial too?" should not need a scroll to answer. */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    padding: '4px 10px',
                    borderRadius: 999,
                    color: 'var(--emerald)',
                    background: 'rgba(16, 185, 129, 0.13)',
                    marginBottom: 12,
                  }}
                >
                  <span aria-hidden="true">✓</span>
                  {trialDays}-day free trial
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px', lineHeight: 1.5 }}>{p.text}</p>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {p.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'flex-start' }}>
                      <span style={{ color: 'var(--emerald)' }} aria-hidden="true">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/register?plan=${p.planType || p.name.toLowerCase()}`}
                  className={chosenPlan === p.name || p.highlight ? 'btn btn-primary' : 'btn btn-ghost'}
                  style={{ marginTop: 20, width: '100%', fontSize: 13.5 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Start my {trialDays}-day free trial
                </Link>
                {chosenPlan === p.name && (
                  <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--violet)' }}>
                    Selected
                  </div>
                )}
              </motion.button>
            ))}
          </div>

          <p
            style={{
              textAlign: 'center',
              fontSize: 12.5,
              color: 'var(--text-muted)',
              marginTop: 22,
              lineHeight: 1.6,
            }}
          >
            No card needed to start. Cancel any time — payments are handled by Stripe, and Taxify never sees your card
            details. Prices in AUD.
          </p>
        </section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="card"
          style={{
            padding: 'clamp(28px, 5vw, 48px)',
            textAlign: 'center',
            marginBottom: 'clamp(32px, 6vw, 56px)',
          }}
        >
          <h2 style={{ fontSize: 'clamp(22px, 3.5vw, 28px)', margin: '0 0 12px', fontWeight: 800 }}>
            Ready to stop losing receipts?
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 15, maxWidth: 480, margin: '0 auto 24px' }}>
            Start your {trialDays}-day free trial and have your first expense logged before your coffee’s cold.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
            <Link to="/register" className="btn btn-primary" style={{ padding: '13px 28px', fontSize: 15 }}>
              Start free trial
            </Link>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <AndroidDownloadButton variant="card" />
          </div>
        </motion.section>
      </main>

      <footer style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', padding: '16px 20px' }}>
        © {new Date().getFullYear()} Taxify · Powered by{' '}
        <a href="https://mikesapphub.com" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
          Mikes App Hub
        </a>
      </footer>
    </div>
  );
}
