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
  };
}
