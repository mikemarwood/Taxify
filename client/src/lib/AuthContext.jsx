import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import { setDateLocale } from './dates.js';
import { setBaseCurrency } from './money.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Re-reads the session from the server. Used after something changes the
  // account from outside this tab — confirming a new email address, say.
  const refresh = useCallback(async () => {
    const res = await api.get('/auth/me');
    setUser(res.data.user);
    return res.data.user;
  }, []);

  // Dates are shown in dozens of places that have no business knowing about
  // the user, so the account's locale is published once, here.
  useEffect(() => {
    setDateLocale(user?.locale);
    setBaseCurrency(user?.currency);
  }, [user?.locale, user?.currency]);

  const login = useCallback(async (email, password, publicDevice) => {
    const res = await api.post('/auth/login', { email: email.trim().toLowerCase(), password, publicDevice });
    if (res.data.otpRequired) {
      // expiresInSeconds is what the countdown runs on — it was dropped here,
      // so the code screen silently fell back to a hard-coded five minutes.
      return {
        otpRequired: true,
        userId: res.data.userId,
        expiresAt: res.data.expiresAt,
        expiresInSeconds: res.data.expiresInSeconds,
      };
    }
    setUser(res.data.user);
    return { otpRequired: false, user: res.data.user };
  }, []);

  const verifyOtp = useCallback(async (userId, code, publicDevice) => {
    const res = await api.post('/auth/otp/verify', { userId, code, publicDevice });
    setUser(res.data.user);
    return res.data.user;
  }, []);

  // The whole sign-up form goes over in one object — it has enough fields now
  // that a positional argument list would be a liability.
  const register = useCallback(async (fields) => {
    const res = await api.post('/auth/register', { ...fields, email: fields.email.trim().toLowerCase() });
    return res.data;
  }, []);

  const checkActivationToken = useCallback(async (token) => {
    const res = await api.get(`/auth/activate/check?token=${encodeURIComponent(token)}`);
    return res.data;
  }, []);

  // Activation is also where the password is set, so this is a POST now.
  const activate = useCallback(async (token, password) => {
    const res = await api.post('/auth/activate', { token, password });
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const acceptInvite = useCallback(async (token, password) => {
    const res = await api.post('/auth/accept-invite', { token, password });
    setUser(res.data.user);
    return res.data.user;
  }, []);

  // Returns how many seconds until it can be asked for again, so the button
  // can count down rather than just refusing.
  const resendActivation = useCallback(async (email) => {
    const res = await api.post('/auth/resend-activation', { email: email.trim().toLowerCase() });
    return res.data?.retryAfterSeconds ?? 300;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (fields) => {
    const res = await api.patch('/auth/profile', { ...fields, email: fields.email.trim().toLowerCase() });
    setUser(res.data.user);
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.patch('/auth/password', { currentPassword, newPassword });
  }, []);

  const setOtpEnabled = useCallback(async (enabled) => {
    const res = await api.patch('/auth/otp-settings', { enabled });
    setUser((u) => (u ? { ...u, otpEnabled: res.data.otpEnabled, mfaPromptDue: false } : u));
  }, []);

  const dismissMfaPrompt = useCallback(async () => {
    await api.post('/auth/otp/dismiss-prompt');
    setUser((u) => (u ? { ...u, mfaPromptDue: false } : u));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refresh,
        login,
        verifyOtp,
        register,
        activate,
        checkActivationToken,
        acceptInvite,
        resendActivation,
        logout,
        updateProfile,
        changePassword,
        setOtpEnabled,
        dismissMfaPrompt,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
