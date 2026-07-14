import { motion } from 'framer-motion';
import AndroidDownloadButton from '../components/AndroidDownloadButton.jsx';

const FEATURES = [
  { icon: '👥', title: 'Built for every user', text: 'Each account gets its own private set of expenses, categories, and receipts.' },
  { icon: '🏷️', title: 'Tax categories, ready to go', text: 'Start with General, Training, Tooling, Electronics, Home Rental, and more — no setup.' },
  { icon: '🧾', title: 'Drag-and-drop receipts', text: 'Snap or drag a receipt in and watch it upload with live progress — no fumbling with forms.' },
  { icon: '📈', title: 'Year-over-year reports', text: 'Compare spending by category across tax years at a glance, ready for tax time.' },
  { icon: '🔒', title: 'Passwords, properly secured', text: 'Every password is hashed with bcrypt before it ever touches the database.' },
  { icon: '⚡', title: 'Fast, dark, and colourful', text: 'A snappy interface that stays out of your way, built to actually enjoy using.' },
];

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          gap: 40,
          flexWrap: 'wrap',
        }}
      >
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        style={{ maxWidth: 420, padding: '0 8px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <img src="/logo.svg" alt="Taxify" width="36" height="36" />
          <span style={{ fontWeight: 800, fontSize: 22 }}>Taxify</span>
        </div>
        <h2 style={{ fontSize: 24, margin: '0 0 20px', lineHeight: 1.3 }}>
          The simplest way to track tax-deductible spending, all year round.
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>{f.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{f.text}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 28 }}>
          <AndroidDownloadButton />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
        className="card"
        style={{ width: '100%', maxWidth: 400, padding: 32 }}
      >
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{title}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 24px' }}>{subtitle}</p>
        {children}
      </motion.div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', padding: '16px 20px' }}>
        © {new Date().getFullYear()} Taxify · Powered by{' '}
        <a href="https://mikesapphub.com" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
          Mikes App Hub
        </a>
      </div>
    </div>
  );
}
