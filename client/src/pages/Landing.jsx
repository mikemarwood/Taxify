import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AndroidDownloadButton from '../components/AndroidDownloadButton.jsx';

const FEATURES = [
  {
    icon: '🧾',
    title: 'Drag-and-drop receipts',
    text: 'Snap a photo or drag a file in and watch it upload with live progress. Every receipt lives right alongside the expense it belongs to.',
  },
  {
    icon: '🏷️',
    title: 'Tax categories, ready to go',
    text: 'Start with a full set of deduction categories — General, Training, Tooling, Electronics, Home Rental and more — no setup required.',
  },
  {
    icon: '🔁',
    title: 'Recurring expenses',
    text: 'Mark a bill as weekly, monthly, quarterly, or yearly once, and it stays flagged for you every time it comes around.',
  },
  {
    icon: '🌐',
    title: 'Multi-currency support',
    text: 'Log expenses in AUD, USD, GBP, EUR, or NZD — perfect for contractors and travellers working across borders.',
  },
  {
    icon: '🔎',
    title: 'Instant search & filters',
    text: 'Filter by category, custom date range, or search by keyword to find any entry in seconds — even years of records.',
  },
  {
    icon: '📈',
    title: 'Year-over-year reports',
    text: 'Compare spending by category across tax years at a glance, with visual breakdowns ready for tax time.',
  },
  {
    icon: '🔒',
    title: 'Bank-grade account security',
    text: 'Passwords are hashed with bcrypt and never stored in plain text, with email-based two-factor login codes to keep your account yours alone.',
  },
  {
    icon: '📱',
    title: 'Take it anywhere',
    text: 'Use Taxify in any browser, or install the Android app for quick expense logging on the go.',
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
      <div style={{ fontSize: 26, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{text}</div>
    </motion.div>
  );
}

export default function Landing() {
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
            <span aria-hidden="true">✨</span> Built for freelancers, tradies &amp; small business owners
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
            No credit card required · Set up in under a minute
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
            ['8', 'Ready-made tax categories'],
            ['5', 'Currencies supported'],
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
            Create your free account and have your first expense logged before your coffee's cold.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
            <Link to="/register" className="btn btn-primary" style={{ padding: '13px 28px', fontSize: 15 }}>
              Create your free account
            </Link>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <AndroidDownloadButton />
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
