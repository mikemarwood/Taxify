// Telling the server what was looked at, and what was pressed.
//
// Three rules this holds itself to, because measurement that gets in the way
// stops being worth having:
//
//   It never blocks. Every call returns immediately and the request goes out
//   behind it. Nothing waits on a beacon.
//
//   It never throws. A blocked request, an ad blocker, a dead network — all of
//   it is swallowed. The one thing worse than not knowing how many people
//   visited is a page that will not render because it could not say.
//
//   It sends no content. A path, a button name, and what the browser already
//   told the server in its own headers. Not what is on the page, not what was
//   typed, and nothing from an expense.

const ENDPOINT = '/api/analytics/event';

// The last path reported, so a re-render is not a second view.
//
// React re-runs effects for reasons that have nothing to do with navigation —
// a context updating, a parent re-rendering — and each one would otherwise be
// a page view. The count would then be a measure of how the app is built
// rather than of what anybody did.
let lastPath = null;

function send(body) {
  try {
    const payload = JSON.stringify({ ...body, url: window.location.href, referrer: document.referrer || '' });

    // sendBeacon survives the page being closed, which a fetch does not: a
    // click that navigates away is exactly the click most worth recording, and
    // an ordinary request is cancelled as the page unloads.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      credentials: 'include',
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing to do and nothing worth saying.
  }
}

// A page was looked at.
export function trackView(path) {
  const next = String(path || window.location.pathname);
  if (next === lastPath) return;
  lastPath = next;
  send({ surface: 'app', event: 'view', path: next });
}

// Something was pressed. `label` is what to call it on the report — write it
// for somebody reading a list of them a month from now, not for the code.
export function trackClick(event, label = null) {
  send({ surface: 'app', event: String(event), label, path: window.location.pathname });
}
