import BackButton from './BackButton.jsx';
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
  //
  // No footer of its own either. The product panel carries terms, privacy and
  // the copyright at its foot, the same as it does on sign-in, and this had a
  // second copy of all three a few inches to the right.
  return (
    <AuthSplitFrame fixed>
      <ProductPanel />
    {/* The column that scrolls, not the window.

        The panel beside this carries the share buttons, the three
        reassurances and the legal links at its foot, and on a long document —
        the privacy policy runs to several screens — the whole page scrolled and
        took all of that away with it.

        The first attempt at this pinned the shell and gave the scroll to
        .auth-content, a class this page does not use, so nothing scrolled at
        all and terms and privacy could not be read past the fold. Hence a class
        of its own. */}
    <div className="public-content" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg)', minWidth: 0 }}>
      <main style={{ flex: 1, padding: '26px 18px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <AuthMobileBrand />

          <BackButton />

          {children}
        </div>
      </main>

    </div>
    </AuthSplitFrame>
  );
}
