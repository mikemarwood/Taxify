import { motion } from 'framer-motion';

export default function AuthLayout({ title, subtitle, children }) {
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
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="card"
        style={{ width: '100%', maxWidth: 400, padding: 32 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <img src="/logo.svg" alt="Taxify" width="40" height="40" />
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>Taxify</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Track deductions, effortlessly</div>
          </div>
        </div>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{title}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 24px' }}>{subtitle}</p>
        {children}
      </motion.div>
    </div>
  );
}
