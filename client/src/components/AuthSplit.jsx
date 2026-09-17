import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import SocialShare from './SocialShare.jsx';

// The shared frame for every signed-out page: a navy brand side running edge
// to edge, and the form on paper beside it. Full bleed rather than a centred
// card — on a wide screen a card leaves most of the page empty, which reads as
// unfinished however good the card is.
//
// Below 900px the two stack and the brand side goes underneath the form rather
// than being dropped: the fields are what somebody came for and they stay at
// the top, but the reasons to want an account are worth reading by whoever
// scrolls past them. The ordering is in theme.css.
//
// The grid itself, exported so sign-up can use it directly — its form element
// has to span both columns, which it can't do through the `aside` prop.
// `fixed` pins the shell to the viewport and lets each column scroll its own
// content. Right for a form, wrong for a document: PublicShell puts Terms and
// Privacy in this same frame, and those have to scroll as a page.
export function AuthSplitFrame({ children, fixed = false }) {
  return (
    <div
      className={fixed ? 'signup-shell signup-shell-fixed' : 'signup-shell'}
      style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(360px, 44%) 1fr' }}
    >
      {children}
    </div>
  );
}

// On a phone the brand rail is below the fold, so the page would otherwise
// open with no sign of whose it is. This puts the mark back at the top.
export function AuthMobileBrand() {
  return (
    <div className="auth-mobile-brand">
      <div className="auth-mobile-brand-row">
        <img src="/logo.svg" alt="" width="42" height="42" />
        <strong>Taxify</strong>
      </div>
      <small>Receipts. Sorted.</small>
    </div>
  );
}

export default function AuthSplit({ aside, topRight, children }) {
  return (
    <AuthSplitFrame fixed>
      {aside || <ProductPanel />}

      <section
        className="auth-content"
        style={{
          // Paper against the navy, so the halves read as chrome and content
          // rather than as one flat surface. Transparent on a phone, where the
          // shell's navy is the ground and the form is a card laid on it.
          background: 'var(--bg-elevated)',
          padding: 'clamp(20px, 4vw, 48px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {topRight}
        <AuthMobileBrand />
        {children}
      </section>
    </AuthSplitFrame>
  );
}

// The four audiences, the same four the landing page leads with, in the same
// order and the same colours. Somebody arriving at sign-in from an ad has very
// likely just read that row; seeing it again here is recognition rather than
// repetition, and the disc colour is what carries it.
const AUDIENCES = [
  {
    icon: 'wrench',
    photo: '/media/show-tradie.jpg',
    alt: 'A tradesman leaning against his ute, phone in hand',
    tint: 'linear-gradient(140deg, #2f8bf4, #1559b8)',
    title: 'Tradies',
    text: 'Fuel, tools, materials and meals.',
  },
  {
    icon: 'briefcase',
    photo: '/media/show-business.jpg',
    alt: 'A small-business owner standing in her café',
    tint: 'linear-gradient(140deg, #23a866, #0c7343)',
    title: 'Small Business',
    text: 'Keep the books separate, ready for tax time.',
  },
  {
    icon: 'home',
    photo: '/media/show-rental.jpg',
    alt: 'A modern Australian house at dusk',
    tint: 'linear-gradient(140deg, #f0913a, #cf6a11)',
    title: 'Rental Properties',
    text: 'Repairs, rates and maintenance in one place.',
  },
  {
    icon: 'user',
    photo: '/media/show-individual.jpg',
    alt: 'A woman working at a laptop at her kitchen table',
    tint: 'linear-gradient(140deg, #9a6ae8, #6d3fc4)',
    title: 'Individuals',
    text: 'Work-related and personal, never missed.',
  },
];

export const ASSURANCES = [
  { icon: 'lock', title: 'Secure & private', text: 'Your data is protected' },
  { icon: 'cpu', title: 'Access anywhere', text: 'On all your devices' },
  { icon: 'clock', title: 'Ready for tax time', text: 'Export all receipts in 1 click' },
];

export function ProductPanel({ headline }) {
  return (
    <aside
      className="signup-brand"
      style={{
        position: 'relative',
        background: 'transparent',
        padding: '40px clamp(24px, 3vw, 46px) 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 26,
        minWidth: 0,
      }}
    >
      {/* Hidden on a phone, where AuthMobileBrand has already said it at the
          top of the page — repeating it here would be the same mark twice on
          one screen. */}
      <div className="auth-brand-wide" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/logo.svg" alt="" width="40" height="40" />
        <span style={{ minWidth: 0, lineHeight: 1.1 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 26, letterSpacing: -0.8, color: 'var(--nav-text-active)' }}>
            Taxify
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--nav-text)' }}>Receipts. Sorted.</span>
        </span>
      </div>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 'clamp(25px, 2.6vw, 34px)',
              lineHeight: 1.16,
              letterSpacing: -1,
              color: 'var(--nav-text-active)',
              textWrap: 'balance',
            }}
          >
            {headline || (
              <>
                Every receipt where you left it,{' '}
                <span style={{ color: 'var(--nav-accent)' }}>come tax time.</span>
              </>
            )}
          </h2>
          <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--nav-text)', maxWidth: '46ch' }}>
            Take a photo, we&rsquo;ll store it on the cloud. Keep your expenses organised, categorised and ready when
            you need them.
          </p>
        </div>

        {/* The four the landing page leads with, in its order and its colours.
            The photographs are the same files, so there is one copy of each to
            replace rather than a set that can drift out of step. */}
        <div className="brand-aud">
          {AUDIENCES.map((a, i) => (
            <motion.div
              key={a.title}
              className="brand-aud-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.15 + i * 0.07 }}
            >
              <div className="brand-aud-photo">
                <img src={a.photo} alt={a.alt} width="1100" height="619" loading="lazy" decoding="async" />
                <span className="brand-aud-mark" style={{ background: a.tint }}>
                  <Icon name={a.icon} size={16} />
                </span>
              </div>
              <div className="brand-aud-body">
                <b>{a.title}</b>
                <span>{a.text}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="brand-foot" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 8 }}>
        {/* The same buttons the landing page carries, from the same admin
            settings, sharing the same address — see SocialShare.jsx. Renders
            nothing at all when Facebook is switched off. */}
        <SocialShare />
        <div className="auth-assurances" style={{ justifyContent: 'flex-start', borderTop: '1px solid var(--nav-border)', paddingTop: 18 }}>
          {ASSURANCES.map((a) => (
            <span key={a.title} className="auth-assurance">
              <span className="auth-assurance-mark" style={{ background: 'rgba(86, 163, 245, 0.16)', color: 'var(--nav-accent)' }}>
                <Icon name={a.icon} size={17} />
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={{ color: 'var(--nav-text-active)' }}>{a.title}</b>
                <span style={{ color: 'var(--nav-text)' }}>{a.text}</span>
              </span>
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}
