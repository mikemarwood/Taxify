import { Link } from 'react-router-dom';
import SiteFooter from './SiteFooter.jsx';

// The shell both legal pages share, so they cannot drift apart in tone or
// layout. Readable at a phone width, with a contents list — nobody reads these
// top to bottom, they arrive looking for one clause.

// The back button and the logo that used to head this page are both gone.
// Signed out, the shell around it draws the brand and the one Back button the
// whole signed-out side shares — this page was adding a second of each a few
// pixels away. Signed in, the sidebar is here, which is a better way back than
// any button.
export function LegalPage({ title, summary, updated, sections, children }) {
  return (
    /* No padding or min-height of its own any more: it is always inside
       something now — the signed-out shell or the app layout — and both bring
       their own, which showed as a band of empty page above the card. */
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 760 }}>
        <div className="card" style={{ padding: 'clamp(20px, 4vw, 36px)' }}>
          <h1 style={{ fontSize: 'clamp(22px, 4vw, 27px)', margin: '0 0 6px', letterSpacing: -0.4 }}>{title}</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 18px' }}>Last updated {updated}</p>

          {/* Said once, in plain words, before the numbered clauses. Somebody
              who reads only this paragraph should still come away with the
              truth of it. */}
          <p
            style={{
              margin: '0 0 26px',
              padding: '14px 16px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-inset)',
              border: '1px solid var(--border)',
              fontSize: 14,
              lineHeight: 1.65,
            }}
          >
            {summary}
          </p>

          <nav aria-label="Contents" style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: 'var(--text-muted)', marginBottom: 8 }}>
              CONTENTS
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4, fontSize: 13.5 }}>
              {sections.map((s, i) => (
                <li key={s}>
                  <a href={`#s${i + 1}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    {s}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 26, fontSize: 14, lineHeight: 1.68 }}>
            {children}
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 22, textAlign: 'center' }}>
          <Link to="/terms" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Terms of Service
          </Link>
          <span style={{ margin: '0 10px', opacity: 0.5 }}>·</span>
          <Link to="/privacy" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Privacy Policy
          </Link>
        </p>

        <SiteFooter style={{ marginTop: 18 }} />
      </div>
    </div>
  );
}

export function Section({ n, title, children }) {
  return (
    <section id={`s${n}`} style={{ scrollMarginTop: 20 }}>
      <h2 style={{ fontSize: 16.5, margin: '0 0 10px', letterSpacing: -0.2 }}>
        <span style={{ color: 'var(--text-subtle)', fontWeight: 600, marginRight: 8 }}>{n}.</span>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--text)' }}>{children}</div>
    </section>
  );
}

export function P({ children }) {
  return <p style={{ margin: 0 }}>{children}</p>;
}

export function List({ items }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
