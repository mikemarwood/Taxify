import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const data = err?.response?.data || {};
    const message = data.error || 'Something went wrong. Please try again.';
    const wrapped = new Error(message);
    if (data.lockedUntil) wrapped.lockedUntil = data.lockedUntil;
    if (data.attemptsRemaining !== undefined) wrapped.attemptsRemaining = data.attemptsRemaining;
    return Promise.reject(wrapped);
  }
);
