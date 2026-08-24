// The Facebook buttons on the landing page, filled in on the way out.
//
// Same reasoning as the advertisement slots next door: the page has no
// JavaScript it can depend on, because the hub proxy strips every script from
// it for a real browser navigation. HTML comments survive, which is what makes
// them usable as markers.
//
// That constraint also decides which Facebook buttons these are. The official
// Like button is normally the JS SDK from connect.facebook.net, and on this
// page that script would simply be removed. Facebook also publishes the same
// plugins as plain iframes, and an iframe is markup — so that is the version
// used here. The Share button is a plain link to the sharer, which needs
// neither a script nor an iframe and works everywhere including with an ad
// blocker in the way.

// Facebook renders these at a fixed size, and the iframe has to be told the
// same size or it scrolls its own content.

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Only http(s), and only a URL that parses. This ends up inside an iframe src
// and an href on a public page, so a javascript: or data: URL arriving from
// the admin settings table must not be written into either.
export function safeHttpUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

// The markup for the two buttons, or null when there is nothing to show.
export function socialButtonsHtml({ shareUrl, pageUrl }) {
  const target = safeHttpUrl(shareUrl);
  if (!target) return null;

  const encoded = encodeURIComponent(target);
  const follow = safeHttpUrl(pageUrl);

  // No Like button, and it is not coming back in this form.
  //
  // Facebook's Like is an iframe onto facebook.com — there is no version of it
  // that is not. Visitors reach this page through the hub proxy, which serves
  // it under "default-src 'self'" with no frame-src, so that iframe is refused
  // by the browser before a request is made. It rendered as a small empty gap
  // next to the working buttons.
  //
  // Liking a page from a button that is not on that page needs Facebook's SDK
  // and a registered app id anyway. The honest equivalent is a link to the
  // page itself, which is the "Follow us" button below — set the page address
  // in the admin panel and it appears. Everything here is a plain anchor now,
  // and plain anchors survive both the proxy and its CSP.
  return (
    `<div class="social-row">` +
    `<a class="social-btn" href="https://www.facebook.com/sharer/sharer.php?u=${encoded}" ` +
    `target="_blank" rel="noopener noreferrer">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="15" height="15">` +
    `<path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12Z"/>` +
    `</svg>Share on Facebook</a>` +
    // Straight into a Messenger conversation, which is where most of this kind
    // of recommendation actually happens — one person telling one other.
    //
    // fb-messenger:// rather than the web dialog on purpose: the web one needs
    // a registered Facebook app id, and this needs nothing but Messenger being
    // installed. On a desktop with no Messenger the link does nothing, so it is
    // only offered on a touch device — see the CSS.
    `<a class="social-btn social-btn--messenger" href="fb-messenger://share/?link=${encoded}">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="15" height="15">` +
    `<path d="M12 2C6.3 2 2 6.2 2 11.7c0 3.1 1.4 5.9 3.7 7.7v3.8l3.4-1.9c.9.3 1.9.4 2.9.4 5.7 0 10-4.2 10-9.7S17.7 2 12 2Zm1 13.1-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8Z"/>` +
    `</svg>Send on Messenger</a>` +
    (follow
      ? `<a class="social-btn" href="${escapeAttribute(follow)}" target="_blank" rel="noopener noreferrer">Follow us</a>`
      : '') +
    `</div>`
  );
}

// Fills the marked block in the page, or removes it when Facebook is switched
// off in the admin panel or no share URL has been set. Removing rather than
// leaving it empty, because an empty row still takes its margin and reads as
// something that failed to load.
export function injectLandingSocial(html, config) {
  const markers = /<!--SOCIAL-START-->[\s\S]*?<!--SOCIAL-END-->/;
  if (!markers.test(html)) return html;

  const buttons = config && config.enabled ? socialButtonsHtml(config) : null;
  if (!buttons) return html.replace(markers, '');

  return html.replace(markers, `<!--SOCIAL-START-->${buttons}<!--SOCIAL-END-->`);
}
