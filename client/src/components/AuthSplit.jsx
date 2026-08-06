import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import SignupArtwork from './SignupArtwork.jsx';

// The shared frame for every signed-out page: a navy brand side running edge
// to edge, and the form on paper beside it. Full bleed rather than a centred
// card — on a wide screen a card leaves most of the page empty, which reads as
// unfinished however good the card is.
//
// Below 900px the brand side is dropped rather than stacked: on a phone it
// would push the form off screen, and the form is what someone came for.
// The grid itself, exported so sign-up can use it directly — its form element
// has to span both columns, which it can't do through the `aside` prop.
export function AuthSplitFrame({ children }) {
  return (
    <div
      className="signup-shell"
      style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(360px, 40%) 1fr' }}
    >
      {children}
    </div>
  );
}

// On a phone the left rail is gone, so the page would otherwise open with no
// sign of whose it is. This puts the mark back where the rail was.
export function AuthMobileBrand() {
  return (
    <div className="auth-mobile-brand">
      <img src="/logo.svg" alt="" width="34" height="34" />
      <span>Taxify</span>
    </div>
  );
}

export default function AuthSplit({ aside, children }) {
  return (
    <AuthSplitFrame>
      {aside || <ProductPanel />}

      <section
        className="auth-content"
        style={{
          // Paper against the navy, so the halves read as chrome and content
          // rather than as one flat surface.
          background: 'var(--bg-card)',
          padding: 'clamp(22px, 5vw, 56px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <AuthMobileBrand />
        {children}
      </section>
    </AuthSplitFrame>
  );
}

const FEATURES = [
  { icon: 'receipt', title: 'Receipts, filed automatically', text: 'Drop one in and it lands in the right year and category on its own.' },
  { icon: 'chart', title: 'Ready for tax time', text: 'Year-over-year totals by category, exported to Excel or PDF in a click.' },
  { icon: 'home', title: 'Property rentals', text: 'Keep statements and end-of-year documents against the property itself.' },
  { icon: 'users', title: 'Share the books', text: 'Add a second user, or give your accountant read-only access any time.' },
];

export function ProductPanel({ headline = 'Every receipt where you left it, come tax time.' }) {
  return (
    <aside
      className="signup-brand"
      style={{
        position: 'relative',
        background: 'var(--nav-bg)',
        padding: '40px 40px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
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
        {headline}
      </h2>

      <div className="signup-art" style={{ display: 'flex', justifyContent: 'center' }}>
        <SignupArtwork />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.15 + i * 0.07 }}
            style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}
          >
            <Icon name={f.icon} size={17} style={{ color: 'var(--nav-accent)', marginTop: 2, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--nav-text-active)' }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--nav-text)', lineHeight: 1.5, marginTop: 1 }}>{f.text}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            { icon: 'gift', label: '14-day free trial' },
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
  );
}
