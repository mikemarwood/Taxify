import { motion } from 'framer-motion';
import AuthSplit, { ASSURANCES } from '../components/AuthSplit.jsx';
import Icon from '../components/Icon.jsx';

// Every signed-out page other than sign-up: log in, activate, accept an
// invite. Sign-up has its own aside because it shows step progress there;
// everything else gets the product panel.
//
// The form sits on a white card rather than directly on the page. That is what
// makes the phone layout work: below 900px the shell is navy all the way down
// and the brand panel stacks underneath, so the fields need a sheet of their
// own to sit on. On a wide screen the same card reads as the object the eye is
// meant to land on in an otherwise empty half.
//
// No Back at the top. Every page using this already offers its own way out at
// the foot of the form — Back to sign in, Cancel, Go to sign in, Send a new
// link — and the one at the foot is the one somebody is already looking at
// when they decide to leave. A second at the top was two ways off the same
// page, side by side, doing slightly different things: one went to history,
// which from the middle of a sign-in means leaving it altogether.
//
// PublicShell keeps its Back, because support and the legal pages have no
// exit of their own to duplicate.
export default function AuthLayout({ title, subtitle, topRight, assurances = true, children }) {
  return (
    <AuthSplit topRight={topRight}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: '100%', maxWidth: 460, margin: '0 auto' }}
      >
        <div className="auth-card">
          {/* The mark inside the card, where the rail is showing. On a phone
              the rail has moved below the fold and AuthMobileBrand has already
              said this at the top of the page, so this one stands down rather
              than printing the same logo twice on one screen. */}
          <div
            className="auth-brand-wide"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, marginBottom: 16 }}
          >
            <img src="/logo.svg" alt="" width="34" height="34" />
            <span style={{ lineHeight: 1.1 }}>
              <span style={{ display: 'block', fontWeight: 800, fontSize: 23, letterSpacing: -0.7 }}>Taxify</span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)' }}>Snap. Store. Sorted.</span>
            </span>
          </div>

          {/* The gap below the heading belongs to whichever of the two is last.
              An empty <p> still claimed its margin, so a page with no subtitle —
              the ones that draw their own message instead — got the spacing and
              an empty paragraph in the document with it. */}
          <h1
            style={{
              fontSize: 'clamp(23px, 2.4vw, 29px)',
              margin: subtitle ? '0 0 5px' : '0 0 24px',
              letterSpacing: -0.6,
              textAlign: 'center',
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 24px', textAlign: 'center' }}>
              {subtitle}
            </p>
          )}
          {children}
        </div>

        {/* Under the card, not in it. They are reasons to trust the thing the
            card belongs to, not part of the job of signing in. */}
        {assurances && (
          <div className="auth-assurances auth-assurances-card auth-outside" style={{ marginTop: 22 }}>
            {ASSURANCES.map((a) => (
              <span key={a.title} className="auth-assurance">
                <span
                  className="auth-assurance-mark"
                  style={{ background: 'var(--auth-out-mark-bg)', color: 'var(--auth-out-mark-fg)' }}
                >
                  <Icon name={a.icon} size={16} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ color: 'var(--auth-out-strong)' }}>{a.title}</b>
                  <span style={{ color: 'var(--auth-out-soft)' }}>{a.text}</span>
                </span>
              </span>
            ))}
          </div>
        )}

      </motion.div>
    </AuthSplit>
  );
}
