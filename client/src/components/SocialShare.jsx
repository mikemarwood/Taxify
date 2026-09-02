import { useEffect, useState } from 'react';
import { trackClick } from '../lib/analytics.js';
import { onShareClick } from '../lib/shareWindow.js';

// The Facebook buttons on the sign-in panel.
//
// Deliberately the same buttons as the landing page, reading the same settings
// and sharing the same address. Switching Facebook off in admin switches it off
// in both places, and what gets shared is the landing URL either way — so its
// Open Graph tags supply the title, the description and the picture, and a link
// posted from here is indistinguishable from one posted from there. Two share
// buttons pointing at two different addresses would be two products as far as
// Facebook is concerned.
//
// One thing this can do that the landing page cannot: the Like button.
//
// Like is an iframe onto facebook.com and there is no version of it that is
// not. The landing page reaches visitors through the hub proxy, which serves it
// under "default-src 'self'" with no frame-src, so the browser refuses that
// iframe before a request leaves — which is why it was taken off that page. The
// app is served by Taxify directly, under no such policy, so here it works.
export default function SocialShare() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Plain fetch, not the api client. That one turns a 503 into the
    // site-is-offline announcement for the whole app, and a decorative button
    // strip failing to load is not that.
    fetch('/api/social', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.enabled && data.shareUrl) setConfig(data);
      })
      .catch(() => {
        // Nothing to show, and nothing worth saying about it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config) return null;

  const encoded = encodeURIComponent(config.shareUrl);
  // The address as somebody would write it. A URL parser returns a bare origin
  // with a trailing slash, which is correct and is not how anybody reads their
  // own site's name — and this goes in the box the sharer types into.
  const quote = encodeURIComponent(String(config.shareUrl).replace(/\/+$/, ''));

  return (
    <div className="social-share">
      <span className="social-share-label">Tell someone about Taxify</span>
      <div className="social-share-row">
        {/* No Like button here either, and the white box it left behind is
            why. It is an iframe onto facebook.com, and an iframe that does not
            load renders as its own background — a blank white rectangle sat in
            the middle of a navy panel looking like something had broken. It
            fails to load often: a blocked third-party frame, a tracking-
            protection setting, or simply not being signed in to Facebook.

            A control whose normal appearance depends on a third party's cookie
            state is not a control we can put on a sign-in page. Follow, below,
            is a plain link to the same page and always looks like itself. */}
        {/* A window rather than a tab. The dialog is two fields and a button,
            and a full tab for it loses the page somebody was on. */}
        <a
          className="social-share-btn"
          href={`https://www.facebook.com/sharer/sharer.php?u=${encoded}&quote=${quote}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            trackClick('share', 'Facebook');
            onShareClick(e);
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14">
            <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12Z" />
          </svg>
          Share
        </a>

        {/* Messenger only where Messenger exists. fb-messenger:// needs the app
            installed; on a desktop the link is inert, and an inert button is
            worse than no button. Same rule as the landing page. */}
        <a className="social-share-btn social-share-btn--messenger" href={`fb-messenger://share/?link=${encoded}`}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14">
            <path d="M12 2C6.3 2 2 6.2 2 11.7c0 3.1 1.4 5.9 3.7 7.7v3.8l3.4-1.9c.9.3 1.9.4 2.9.4 5.7 0 10-4.2 10-9.7S17.7 2 12 2Zm1 13.1-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8Z" />
          </svg>
          Messenger
        </a>

        {config.pageUrl && (
          <a className="social-share-btn" href={config.pageUrl} target="_blank" rel="noopener noreferrer">
            Follow
          </a>
        )}
      </div>
    </div>
  );
}
