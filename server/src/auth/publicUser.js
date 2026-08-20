import { isMfaPromptDue } from './otp.js';
import { localeForCountry } from '../lib/geoData.js';

export function toPublicUser(user, mfaMode) {
  const otpEnabled = mfaMode === 'required' ? true : !!user.otp_enabled;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: !!user.is_admin,
    // Support staff. Separate from isAdmin on purpose: it grants the ticket
    // queue and nothing else.
    isSupport: !!user.is_support,
    avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
    otpEnabled,
    mfaMode,
    mfaPromptDue: mfaMode === 'optional' && !otpEnabled && isMfaPromptDue(user.otp_last_prompted_at),
    role: user.role || 'owner',
    accountHolderId: user.account_holder_id || null,
    planType: user.plan_type || null,
    // What the account is called when a person or an email refers to it.
    accountNumber: user.account_number || null,
    firstName: user.first_name || null,
    lastName: user.last_name || null,
    // Sent as yyyy-mm-dd so a date input can take it directly; the client
    // shows it as dd/mm/yyyy.
    dateOfBirth: user.date_of_birth ? String(user.date_of_birth).slice(0, 10) : null,
    phone: user.phone || null,
    currency: user.currency || null,
    country: user.country || null,
    state: user.state || null,
    businessName: user.business_name || null,
    practiceName: user.practice_name || null,
    // The switch itself, apart from isAccountant — the page needs to know
    // which of the two made them one before it can offer to turn it off.
    actsForClients: !!user.acts_for_clients,
    // How dates should read for this person — from their country, not from
    // whatever the browser happens to be set to.
    locale: localeForCountry(user.country),
    // Which twelve months count as a year here. The client files dates into
    // years too — the year selector, the archive name, which categories a date
    // is offered — so it needs the same rule the server uses. requireAuth
    // overwrites this with the rule of whichever account is actually open.
    financialYearRule: {
      startMonth: user.fy_start_month || 7,
      startDay: user.fy_start_day || 1,
    },
    // Admin-granted access that ignores the subscription. computeAccessLocked
    // reads these off the public shape, so they have to survive the mapping.
    // Set by requireAuth when an admin is viewing this account, so the client
    // can show the banner and hide anything that writes.
    viewedBy: null,
    readOnly: false,
    accessBypass: !!user.access_bypass,
    accessBypassUntil: user.access_bypass_until || null,
    subscriptionStatus: user.subscription_status || 'trialing',
    trialEndsAt: user.trial_ends_at || null,
    subscriptionCurrentPeriodEnd: user.subscription_current_period_end || null,
    stripeCustomerId: user.stripe_customer_id || null,
    // Whether the plan renews itself. A year bought outright has no
    // subscription behind it, so nothing will happen when it ends — which is
    // the difference between "renews on the 9th" and "ends on the 9th", and
    // saying the wrong one is how somebody loses access expecting not to.
    autoRenews: Boolean(user.stripe_subscription_id),
  };
}
