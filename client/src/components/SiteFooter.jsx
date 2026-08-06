// The one footer, so the three that existed cannot drift apart again.
//
// `tone="nav"` is the sidebar's palette, where the ground is dark whatever the
// theme is doing; everything else uses the page's own text colours.

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
      <div>
        © {new Date().getFullYear()} Taxify · Powered by{' '}
        {/* noreferrer as well as noopener: without it the new tab can reach
            back through window.opener. */}
        <a href={HUB} target="_blank" rel="noreferrer" style={{ color: link, fontWeight: 600 }}>
          Mikes App Hub
        </a>
      </div>
      <div style={{ marginTop: 3, opacity: 0.85 }}>
        Looking for our other apps?{' '}
        <a href={HUB} target="_blank" rel="noreferrer" style={{ color: link, fontWeight: 600 }}>
          Visit Mikes App Hub
        </a>
      </div>
    </div>
  );
}
