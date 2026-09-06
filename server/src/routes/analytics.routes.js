import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { optionalAuth } from '../auth/middleware.js';
import { recordPageEvent } from '../lib/pageEvents.js';

const router = Router();

// Recording what happened, three ways, because the page is served three ways.
//
// The app posts a beacon. It is our own origin, scripts run, and a fetch can
// carry the path and whatever the press was.
//
// The landing page cannot post. It is proxied through the hub, and the proxy
// strips every <script> from it — including on the copy served from our own
// address, because that copy is fetched from the hub. So on the marketing page
// there is no JavaScript at all. What the proxy leaves alone is an <img>, so a
// one-pixel image counts the visit.
//
// And a press is counted by going through us: /go/trial writes the row and
// redirects. An image can say somebody arrived; only a link somebody follows
// can say they pressed something, and it needs no script to do it. See
// index.js, where that route lives — it is not under /api because it is a
// place people go, not something the page calls.

// A 1x1 transparent GIF, the smallest thing a browser will accept as an image.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// The app's way in. optionalAuth so a signed-in view can be told from an
// anonymous one without ever requiring a session — the sign-in page itself is
// the most important thing here to measure.
router.post(
  '/event',
  optionalAuth,
  asyncHandler(async (req, res) => {
    await recordPageEvent(req, res, req.body || {});
    res.status(204).end();
  })
);

// The landing page's way in, and the only one that survives the proxy.
//
// Answers with the pixel whatever happens, including when the write fails: a
// broken image on a marketing page is a visible fault caused by an invisible
// feature, which is the wrong way round.
router.get(
  '/px.gif',
  optionalAuth,
  asyncHandler(async (req, res) => {
    await recordPageEvent(req, res, {
      surface: String(req.query.s || 'landing'),
      event: String(req.query.e || 'view'),
      path: String(req.query.p || '/'),
      label: req.query.l ? String(req.query.l) : null,
      referrer: String(req.query.r || req.headers.referer || ''),
      url: String(req.query.u || ''),
    });
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Content-Length', String(PIXEL.length));
    res.end(PIXEL);
  })
);

export default router;
