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
//
// Not setting CLIENT_ORIGIN at all is a different thing, and it used to be
// shouted about in the same breath. It is fine: the constant below is the real
// address, kept in one place, and a correct default beats an environment
// variable somebody has to remember to change. The production server runs this
// way. A leftover localhost value is still a real fault and still says so.

const DEV_DEFAULT = 'http://localhost:5173';

// Where this actually lives. Used only when nothing valid is configured, so
// that a missing setting degrades to correct rather than to localhost.
const PRODUCTION_DEFAULT = 'https://taxify.net.au';

function isLocal(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url);
}

let warned = false;

// Test seam. The warning is deliberately once per process, so a test that
// wants to see it has to be able to put that back.
export function resetOriginWarning() {
  warned = false;
}

export function publicOrigin() {
  const configured = String(process.env.CLIENT_ORIGIN || '').trim().replace(/\/+$/, '');
  const production = process.env.NODE_ENV === 'production';

  if (configured && !(production && isLocal(configured))) return configured;

  if (production) {
    // Only for a value that is set and wrong. Unset is the normal way this
    // runs, and an error logged every restart for the expected case is an
    // error nobody reads by the time there is a real one.
    //
    // Once, not per email — this is called on every link built.
    if (configured && !warned) {
      warned = true;
      console.error(
        `[config] CLIENT_ORIGIN is "${configured}", which cannot be right in production — every link ` +
          `emailed to a customer is built from it, and nobody can open a localhost one. Falling back to ` +
          `${PRODUCTION_DEFAULT}. Correct it in server/.env and restart, or remove it and let the ` +
          `default stand.`
      );
    }
    return PRODUCTION_DEFAULT;
  }

  return configured || DEV_DEFAULT;
}

// The same address, plus where the app actually lives.
//
// The landing page owns the root now and the app sits under /app, so every
// link *into* the app has to say so — an activation link, a password reset, an
// accountant invitation, a support ticket. Get this wrong and the failure is
// invisible until somebody opens their email a week later.
//
// Kept beside publicOrigin rather than folded into it, because the two are
// genuinely different questions: publicOrigin is "where is this site", which
// is still what the landing page, the APK download and the address printed on
// an invoice all want.
export function appOrigin() {
  return `${publicOrigin()}/app`;
}
