import { Link } from 'react-router-dom';
import SiteFooter from './SiteFooter.jsx';
import Icon from './Icon.jsx';
import { AuthSplitFrame, AuthMobileBrand, ProductPanel } from './AuthSplit.jsx';

// The frame for a page somebody reaches without signing in, where there is no
// navigation to give them but the page still has to look like Taxify.
//
// Support is the case it was written for. A form on a bare background reads as
// a different site — or a phishing page — which is the worst impression to give
// somebody whose first thought was already "something is wrong here".
export default function PublicShell({ children }) {
  // The same branded rail the sign-in page has.
  //
  // Support, terms and the privacy policy were a bare header over a white page
  // while /login had the product panel beside it — so the pages somebody lands
  // on when they are already unsure looked the least like Taxify.
  //
  // With the rail there, the logo bar this used to carry was the same mark and
  // the same words repeated a few inches to the right. AuthMobileBrand is the
  // logo that knows to appear only below 900px, where the rail is gone and
  // something has to say whose page this is.
  //
  // What replaces it is the way back. There wasn't one: the header offered
  // "Sign in", which reads as an invitation to start something rather than a
  // way out of a page you opened by accident — and on a phone, where the whole
  // header was the logo, there was nothing at all.
  return (
    <AuthSplitFrame>
      <ProductPanel />
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', minWidth: 0 }}>
      <main style={{ flex: 1, padding: '26px 18px' }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          <AuthMobileBrand />

          <Link
            to="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 18,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--accent)',
              textDecoration: 'none',
            }}
          >
            <Icon name="arrow-left" size={15} />
            Back to sign in
          </Link>

          {children}
        </div>
      </main>

      <footer style={{ padding: '18px', borderTop: '1px solid var(--border)' }}>
        <SiteFooter />
      </footer>
    </div>
    </AuthSplitFrame>
  );
}
