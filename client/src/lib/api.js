import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err?.response?.data?.error || 'Something went wrong. Please try again.';
    return Promise.reject(new Error(message));
  }
);
