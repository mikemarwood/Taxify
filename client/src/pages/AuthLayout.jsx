import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import AuthSplit, { AuthMobileBrand } from '../components/AuthSplit.jsx';
import SiteFooter from '../components/SiteFooter.jsx';

// Every signed-out page other than sign-up: log in, activate, accept an
// invite. Sign-up has its own aside because it shows step progress there;
// everything else gets the product panel.
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <AuthSplit>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}
      >
        <AuthMobileBrand />
        <h1 style={{ fontSize: 'clamp(22px, 2.4vw, 28px)', margin: '0 0 5px', letterSpacing: -0.5 }}>{title}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 26px' }}>{subtitle}</p>
        {children}

        <div
          style={{
            marginTop: 28,
            paddingTop: 16,
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <Link to="/terms" style={{ color: 'inherit' }}>
            Terms
          </Link>
          <Link to="/privacy" style={{ color: 'inherit' }}>
            Privacy
          </Link>
          <SiteFooter align="right" style={{ marginLeft: 'auto' }} />
        </div>
      </motion.div>
    </AuthSplit>
  );
}
