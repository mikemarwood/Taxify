import { isMfaPromptDue } from './otp.js';

export function toPublicUser(user, mfaMode) {
  const otpEnabled = mfaMode === 'required' ? true : !!user.otp_enabled;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: !!user.is_admin,
    avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
    otpEnabled,
    mfaMode,
    mfaPromptDue: mfaMode === 'optional' && !otpEnabled && isMfaPromptDue(user.otp_last_prompted_at),
    role: user.role || 'owner',
    accountHolderId: user.account_holder_id || null,
    planType: user.plan_type || null,
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
    // Admin-granted access that ignores the subscription. computeAccessLocked
    // reads these off the public shape, so they have to survive the mapping.
    accessBypass: !!user.access_bypass,
    accessBypassUntil: user.access_bypass_until || null,
    subscriptionStatus: user.subscription_status || 'trialing',
    trialEndsAt: user.trial_ends_at || null,
    subscriptionCurrentPeriodEnd: user.subscription_current_period_end || null,
    stripeCustomerId: user.stripe_customer_id || null,
  };
}
