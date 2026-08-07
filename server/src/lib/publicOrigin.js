// The address this site is reachable at, from outside.
//
// Every link Taxify sends anybody is built from this: activation, password
// reset, accountant invitations, the Stripe return URL, the APK download. It
// came from `process.env.CLIENT_ORIGIN || 'http://localhost:5173'` in twenty-one
// places, so a .env still carrying the development value — which is what
// happened — put http://localhost:5173 into real customers' email. A password
// reset link nobody can open is indistinguishable from a broken account.
//
// A localhost origin is therefore refused in production rather than trusted.
// It is never right, it is only ever left over, and the cost of guessing wrong
// here is lower than the cost of sending it.

const DEV_DEFAULT = 'http://localhost:5173';

// Where this actually lives. Used only when nothing valid is configured, so
// that a missing setting degrades to correct rather than to localhost.
const PRODUCTION_DEFAULT = 'https://taxify.mikesapphub.com';

function isLocal(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url);
}

let warned = false;

export function publicOrigin() {
  const configured = String(process.env.CLIENT_ORIGIN || '').trim().replace(/\/+$/, '');
  const production = process.env.NODE_ENV === 'production';

  if (configured && !(production && isLocal(configured))) return configured;

  if (production) {
    // Once, not per email — this is called on every link built.
    if (!warned) {
      warned = true;
      console.error(
        `[config] CLIENT_ORIGIN is ${configured ? `"${configured}"` : 'not set'}, which cannot be right in ` +
          `production — every link emailed to a customer is built from it. Falling back to ` +
          `${PRODUCTION_DEFAULT}. Set CLIENT_ORIGIN in server/.env and restart.`
      );
    }
    return PRODUCTION_DEFAULT;
  }

  return configured || DEV_DEFAULT;
}
