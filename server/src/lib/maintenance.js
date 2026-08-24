// Taking the app offline on purpose, and saying which kind of offline it is.
//
// Pure string and validation work, no database — the same split as
// landingSocial.js and socialSettings.js, so this half can be unit-tested
// without opening a connection. maintenanceSettings.js is the half that reads
// and writes the settings table.
//
// The distinction the two reasons draw is the whole point of the feature.
// "Down for maintenance" says somebody chose this and knows when it ends;
// "technical difficulties" says something broke and is being worked on. They
// call for different words and they leave the reader in a different state, and
// a single generic "we'll be back soon" that covers both tells them neither.

export const MAINTENANCE_REASONS = ['maintenance', 'technical'];

// What each reason actually says. Written out rather than assembled from
// fragments, because these are the only words somebody locked out of their own
// records is going to get and they should read like a person wrote them.
const COPY = {
  maintenance: {
    heading: 'Taxify is down for maintenance',
    // No apology. This was planned, it is short, and treating a scheduled
    // window as a disaster invites the reader to treat it as one too.
    body: 'We are making some changes and will be back shortly. Nothing you have saved is affected — your expenses, receipts and reports are all exactly where you left them.',
  },
  technical: {
    heading: 'Taxify is having technical difficulties',
    // This one does apologise, because something is wrong and it is ours.
    // It also says the thing people most want to know and would otherwise
    // spend the outage worrying about: their records are not the problem.
    body: 'Sorry — something is not working properly and we are on it. Your expenses, receipts and reports are safe and nothing has been lost. Please try again in a little while.',
  },
};

export function isMaintenanceReason(value) {
  return MAINTENANCE_REASONS.includes(value);
}

// The notice a locked-out visitor is shown.
//
// `message` overrides the stock body when an admin has written something more
// specific — "back by 6pm, we are migrating the database" beats any wording
// chosen in advance. The heading is never overridden: it is what makes the two
// situations distinguishable at a glance, and it is one line, so there is
// nothing to gain by letting it drift.
export function maintenanceNoticeFrom({ reason, message } = {}) {
  const key = isMaintenanceReason(reason) ? reason : 'maintenance';
  const custom = typeof message === 'string' ? message.trim() : '';
  return {
    reason: key,
    heading: COPY[key].heading,
    body: custom || COPY[key].body,
    // So the page can say "this is our own wording" versus a stock line, and
    // so the admin screen can show which is in force.
    custom: Boolean(custom),
  };
}

// The stock wording, for the admin screen to show as a preview and as the
// placeholder in the box that overrides it.
export function stockNotice(reason) {
  const key = isMaintenanceReason(reason) ? reason : 'maintenance';
  return { ...COPY[key] };
}

// Longest a custom message may be. Enough for two or three sentences of
// explanation, short of enough to paste an incident report into.
export const MAX_MESSAGE_LENGTH = 400;

// Returns an error string, or null when the input is usable. Checked here
// rather than at render time: something that cannot be stored should be
// refused where somebody typed it, not silently dropped an hour later in front
// of the people it was meant for.
export function validateMaintenanceInput({ enabled, reason, message } = {}) {
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return 'enabled must be true or false';
  }
  if (reason !== undefined && !isMaintenanceReason(reason)) {
    return 'reason must be either maintenance or technical';
  }
  if (message !== undefined) {
    if (typeof message !== 'string') return 'message must be text';
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return `The message can be at most ${MAX_MESSAGE_LENGTH} characters`;
    }
  }
  return null;
}

// Paths that keep working while the app is offline.
//
// Without an exact list this feature is a way to lock yourself out of your own
// site: switching it on and then signing in as an admin needs the login route,
// and login needs the second factor behind it. The status endpoint is here so
// the sign-in page can explain itself rather than showing a bare error, and
// logout is here so somebody who was already signed in can leave cleanly
// instead of being held in a session they cannot use.
//
// Deliberately not the whole of /auth. Registering during an outage would
// create an account that cannot be activated, and password reset sends mail
// that lands on a door that will not open.
const ALWAYS_ALLOWED = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/me',
  '/auth/otp/verify',
  '/auth/otp/resend',
  '/maintenance',
]);

export function isAlwaysAllowed(path) {
  // Trailing slashes and query strings are already off req.path, but a router
  // mounted at a prefix can still hand us '/auth/login/'.
  const clean = String(path || '').replace(/\/+$/, '') || '/';
  return ALWAYS_ALLOWED.has(clean);
}
