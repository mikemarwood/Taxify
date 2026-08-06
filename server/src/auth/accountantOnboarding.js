// What an accountant has to have done before they can open somebody's books.
//
// Pure, so it can be tested without a database and so the two places that
// enforce it — the door in /auth/clients/:ownerId and the session check in
// requireAuth — cannot come to different conclusions about the same person.
//
// Two-factor is required of anyone who acts for clients, whatever the site-wide
// setting says. Reading another person's complete financial records is a higher
// bar than signing in to your own account, and the people whose records they
// are did not get a say in how careful their accountant is.

export const ACCOUNTANT_REQUIREMENTS = ['mfa', 'profile'];

// otpEnabled is already mode-aware by the time it reaches here — publicUser.js
// reports it as true whenever the site requires MFA of everyone. So an account
// under `mfa_mode: required` satisfies this without a second code path, and
// only an account under `optional` has anything new to do.
export function accountantSetupState({ isAccountant, otpEnabled, practiceName } = {}) {
  if (!isAccountant) return { ready: true, missing: [] };

  const missing = [];
  if (!otpEnabled) missing.push('mfa');
  if (!String(practiceName || '').trim()) missing.push('profile');

  return { ready: missing.length === 0, missing };
}

// Missing two-factor drops the client from the session; a missing practice name
// only stops them opening a new one.
//
// The asymmetry is deliberate and is what keeps this from being cruel. A blank
// firm name is cosmetic, and ejecting somebody from books they are part-way
// through reading over it would be absurd. Two-factor is the actual protection,
// so that one takes effect immediately.
export function blocksExistingSession(setup) {
  return !!setup?.missing?.includes('mfa');
}
