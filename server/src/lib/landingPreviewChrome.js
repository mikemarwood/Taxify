// The Mikes App Hub bar and footer, for the draft landing page only.
//
// The live page gets these from the hub: a real visitor is served the hub's
// copy, and the hub wraps whatever it fetched in its own navigation and
// footer. The draft at /landing2 is served straight from the file and never
// touches the hub, so it arrived without them and looked nothing like the
// finished thing.
//
// Injected here rather than written into landing2.html, and that is the whole
// point of the file. The day the draft becomes the landing page it goes back
// through the hub, which adds this chrome itself — and a copy baked into the
// markup would then appear twice. Kept out here, promoting the page is a
// straight swap with nothing to remember and nothing to undo.
//
// A reproduction, not the hub's own code. It is close enough to judge a layout
// against and will drift the day the hub restyles; the finished page takes the
// real thing from the hub regardless, so drift here costs a slightly stale
// preview and nothing more.

const MARKER = '<!--HUB-CHROME-->';

const STYLE = `<style>
  body { padding-top: 68px; }
  .mah-landing-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 2000;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 clamp(16px, 4vw, 48px); height: 68px;
    background: rgba(7, 11, 20, .95);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(59, 130, 246, .12);
    font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .mah-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; color: #fff; text-decoration: none; letter-spacing: -.3px; }
  .mah-nav-right { display: flex; align-items: center; gap: 14px; }
  .mah-link-pill {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .12);
    border-radius: 8px; padding: 7px 13px; color: #cbd5e1;
    text-decoration: none; font-size: 14px; font-weight: 500;
  }
  .mah-link-pill:hover { background: rgba(255, 255, 255, .1); color: #fff; }
  .mah-cta {
    display: flex; align-items: center; gap: 5px;
    background: linear-gradient(135deg, #2563eb, #3b82f6); color: #fff;
    padding: 7px 12px; border-radius: 8px; font-weight: 700; font-size: 12.5px;
    text-decoration: none; box-shadow: 0 2px 12px rgba(37, 99, 235, .4);
  }
  /* The pill goes before the button does. Below this the two of them crowd a
     phone's width and the one worth pressing loses. */
  @media (max-width: 620px) { .mah-link-pill { display: none; } }

  .mah-shell-footer { background: #05080f; border-top: 1px solid rgba(255, 255, 255, .07); font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .mah-shell-footer-inner {
    max-width: 1120px; margin: 0 auto; padding: 18px clamp(16px, 4vw, 48px);
    display: flex; align-items: center; justify-content: center;
    gap: 10px 24px; flex-wrap: wrap; text-align: center;
  }
  .mah-shell-footer-links { display: flex; gap: 20px; }
  .mah-shell-footer-links a { color: #94a3b8; text-decoration: none; font-size: 13px; }
  .mah-shell-footer-links a:hover { color: #fff; }
  .mah-shell-footer-copy { color: #64748b; font-size: 13px; }
  .mah-shell-footer-spacer { flex: 0 0 auto; }
</style>`;

const NAV = `<nav class="mah-landing-nav" aria-label="Mikes App Hub">
  <a href="https://mikesapphub.com" class="mah-brand">
    <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true"><defs><linearGradient id="mahPreviewG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0078d4"/><stop offset="100%" stop-color="#00b4d8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#mahPreviewG)"/><circle cx="32" cy="32" r="8" fill="none" stroke="white" stroke-width="3"/><circle cx="32" cy="12" r="5" fill="none" stroke="white" stroke-width="2.5"/><circle cx="49" cy="44" r="5" fill="none" stroke="white" stroke-width="2.5"/><circle cx="15" cy="44" r="5" fill="none" stroke="white" stroke-width="2.5"/><line x1="32" y1="24" x2="32" y2="17" stroke="white" stroke-width="2.5"/><line x1="39" y1="37" x2="45" y2="41" stroke="white" stroke-width="2.5"/><line x1="25" y1="37" x2="19" y2="41" stroke="white" stroke-width="2.5"/></svg>
    <span>Mikes App Hub</span>
  </a>
  <div class="mah-nav-right">
    <a class="mah-link-pill" href="https://mikesapphub.com#apps">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
      More Apps
    </a>
    <a class="mah-cta" href="https://taxify.mikesapphub.com/app" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Open Taxify
    </a>
  </div>
</nav>`;

const FOOTER = `<footer class="mah-shell-footer">
  <div class="mah-shell-footer-inner">
    <div class="mah-shell-footer-links">
      <a href="https://mikesapphub.com/terms">Terms</a>
      <a href="https://mikesapphub.com/privacy">Privacy</a>
    </div>
    <div class="mah-shell-footer-copy">&copy; ${new Date().getFullYear()} <strong>Mikes App Hub</strong>. All rights reserved.</div>
    <div class="mah-shell-footer-spacer" aria-hidden="true"></div>
  </div>
</footer>`;

// The style goes in the head where a stylesheet belongs, the bar immediately
// after the body opens and the footer immediately before it closes — the same
// places the hub puts them.
//
// Each insertion falls back to appending rather than failing: this is a
// preview, and half of it is worth more than an exception.
export function injectHubChrome(html) {
  const source = String(html || '');
  if (!source || source.includes(MARKER)) return source;

  let out = source;

  const head = out.indexOf('</head>');
  out = head === -1 ? MARKER + STYLE + out : out.slice(0, head) + MARKER + STYLE + out.slice(head);

  const body = out.indexOf('<body>');
  out = body === -1 ? NAV + out : out.slice(0, body + 6) + NAV + out.slice(body + 6);

  const close = out.lastIndexOf('</body>');
  out = close === -1 ? out + FOOTER : out.slice(0, close) + FOOTER + out.slice(close);

  return out;
}
