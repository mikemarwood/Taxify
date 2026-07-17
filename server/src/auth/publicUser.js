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
    subscriptionStatus: user.subscription_status || 'trialing',
    trialEndsAt: user.trial_ends_at || null,
    subscriptionCurrentPeriodEnd: user.subscription_current_period_end || null,
    stripeCustomerId: user.stripe_customer_id || null,
  };
}
