import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

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

  const login = useCallback(async (email, password, publicDevice) => {
    const res = await api.post('/auth/login', { email: email.trim().toLowerCase(), password, publicDevice });
    if (res.data.otpRequired) {
      return { otpRequired: true, userId: res.data.userId, expiresAt: res.data.expiresAt };
    }
    setUser(res.data.user);
    return { otpRequired: false, user: res.data.user };
  }, []);

  const verifyOtp = useCallback(async (userId, code, publicDevice) => {
    const res = await api.post('/auth/otp/verify', { userId, code, publicDevice });
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const res = await api.post('/auth/register', { name, email: email.trim().toLowerCase(), password });
    setUser(res.data.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (name, email) => {
    const res = await api.patch('/auth/profile', { name, email: email.trim().toLowerCase() });
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
        login,
        verifyOtp,
        register,
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
