// The one footer, so the three that existed cannot drift apart again.
//
// `tone="nav"` is the sidebar's palette, where the ground is dark whatever the
// theme is doing; everything else uses the page's own text colours.

import { Link } from 'react-router-dom';

const HUB = 'https://mikesapphub.com';

export default function SiteFooter({ tone = 'page', align = 'center', style }) {
  const nav = tone === 'nav';
  const muted = nav ? 'var(--nav-text)' : 'var(--text-muted)';
  const link = nav ? 'var(--nav-accent)' : 'var(--accent)';

  return (
    <div
      style={{
        fontSize: nav ? 11 : 12,
        color: muted,
        opacity: nav ? 0.75 : 1,
        lineHeight: 1.6,
        textAlign: align,
        ...style,
      }}
    >
      {/* Two lines in the rail, one on a page. At the sidebar's width the single
          line wrapped mid-link — "Mikes" on one row and "App Hub" on the next —
          so the break is put where it belongs instead of left to chance. */}
      {/* Terms and Privacy, reachable from inside the app.

          They were linked from the sign-in pages and from each other, and from
          nowhere at all once somebody was signed in — so the two documents
          governing an account somebody is paying for could only be found by
          signing out or typing the address. This footer is on every signed-in
          page, in the rail, which is where a person goes looking. */}
      <div style={{ marginBottom: nav ? 3 : 2 }}>
        <Link to="/terms" style={{ color: link }}>
          Terms
        </Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
        <Link to="/privacy" style={{ color: link }}>
          Privacy
        </Link>
      </div>
      <div>© {new Date().getFullYear()} Taxify</div>
      <div style={{ marginTop: nav ? 1 : 0 }}>
        More apps at{' '}
        {/* noreferrer as well as noopener: without it the new tab can reach
            back through window.opener. */}
        <a href={HUB} target="_blank" rel="noreferrer" style={{ color: link, fontWeight: 600 }}>
          Mikes App Hub
        </a>
      </div>
    </div>
  );
}
