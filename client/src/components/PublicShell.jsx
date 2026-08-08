import { Link } from 'react-router-dom';
import SiteFooter from './SiteFooter.jsx';

// The frame for a page somebody reaches without signing in, where there is no
// navigation to give them but the page still has to look like Taxify.
//
// Support is the case it was written for. A form on a bare background reads as
// a different site — or a phishing page — which is the worst impression to give
// somebody whose first thought was already "something is wrong here".
export default function PublicShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
          padding: '12px 18px',
        }}
      >
        <div
          style={{
            maxWidth: 840,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            flexWrap: 'wrap',
          }}
        >
          <Link
            to="/login"
            style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none', color: 'inherit' }}
          >
            <img src="/logo.svg" alt="" width="34" height="34" style={{ borderRadius: 8 }} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>Taxify</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Powered by Mikes App Hub</span>
            </span>
          </Link>

          <span style={{ flex: 1 }} />

          <Link
            to="/login"
            className="btn btn-ghost"
            style={{ fontSize: 12.5, textDecoration: 'none' }}
          >
            Sign in
          </Link>
        </div>
      </header>

      <main style={{ flex: 1, padding: '26px 18px' }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>{children}</div>
      </main>

      <footer style={{ padding: '18px', borderTop: '1px solid var(--border)' }}>
        <SiteFooter />
      </footer>
    </div>
  );
}
