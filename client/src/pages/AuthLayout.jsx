import { motion } from 'framer-motion';
import AuthSplit from '../components/AuthSplit.jsx';
import SiteFooter from '../components/SiteFooter.jsx';

// Every signed-out page other than sign-up: log in, activate, accept an
// invite. Sign-up has its own aside because it shows step progress there;
// everything else gets the product panel.
// No Back at the top.
//
// Every page that uses this already offers its own way out at the foot of
// the form — Back to sign in, Cancel, Go to sign in, Send a new link — and
// the one at the foot is the one somebody is already looking at when they
// decide to leave. A second at the top was two ways off the same page, side
// by side, doing slightly different things: one went to history, which from
// the middle of a sign-in means leaving it altogether.
//
// PublicShell keeps its Back, because support and the legal pages have no
// exit of their own to duplicate.
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <AuthSplit>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}
      >
        {/* The gap below the heading belongs to whichever of the two is last.
            An empty <p> still claimed its margin, so a page with no subtitle —
            the ones that draw their own message instead — got the spacing and
            an empty paragraph in the document with it. */}
        <h1
          style={{
            fontSize: 'clamp(22px, 2.4vw, 28px)',
            margin: subtitle ? '0 0 5px' : '0 0 26px',
            letterSpacing: -0.5,
          }}
        >
          {title}
        </h1>
        {subtitle && <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 26px' }}>{subtitle}</p>}
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
          {/* The Terms and Privacy links that stood here have gone into
              SiteFooter, which now carries them everywhere — including inside
              the app, where they were previously unreachable. Two pairs a few
              centimetres apart on this one page was the cost of that. */}
          <SiteFooter align="left" />
        </div>
      </motion.div>
    </AuthSplit>
  );
}
