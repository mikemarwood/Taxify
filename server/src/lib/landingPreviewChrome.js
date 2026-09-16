// The Mikes App Hub footer, for the draft landing page only.
//
// The live page gets this from the hub: a real visitor is served the hub's
// copy, and the hub wraps whatever it fetched in its own footer. The draft at
// /landing2 is served straight from the file and never touches the hub, so it
// arrived without one.
//
// The hub's navigation bar is deliberately not reproduced. It sat directly
// above Taxify's own bar — two dark bars, one on top of the other, each with a
// brand on the left and a blue button on the right — and the page opened with
// the same control offered twice before a word of it had been read. The page
// has its own bar and it is the better of the two, so this adds only the
// footer.
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

// The style goes in the head where a stylesheet belongs and the footer
// immediately before the body closes, which is where the hub puts it.
//
// Each insertion falls back to appending rather than failing: this is a
// preview, and half of it is worth more than an exception.
export function injectHubChrome(html) {
  const source = String(html || '');
  if (!source || source.includes(MARKER)) return source;

  let out = source;

  const head = out.indexOf('</head>');
  out = head === -1 ? MARKER + STYLE + out : out.slice(0, head) + MARKER + STYLE + out.slice(head);

  const close = out.lastIndexOf('</body>');
  out = close === -1 ? out + FOOTER : out.slice(0, close) + FOOTER + out.slice(close);

  return out;
}
