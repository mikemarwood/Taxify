import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Which set of books every request is about. Published once, the same way the
// base currency and the date locale are, because a header set here cannot be
// forgotten at a call site — and a request that quietly asks about the wrong
// books answers with somebody else's numbers.
//
// Downloads are the exception and carry ?entityId= instead: an <a href> has no
// way to set a header.
let entityId = null;

export function setEntityId(id) {
  entityId = id ? String(id) : null;
}

export function getEntityId() {
  return entityId;
}

api.interceptors.request.use((config) => {
  if (entityId) config.headers['X-Taxify-Entity'] = entityId;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const data = err?.response?.data || {};
    const message = data.error || 'Something went wrong. Please try again.';
    const wrapped = new Error(message);
    if (data.lockedUntil) wrapped.lockedUntil = data.lockedUntil;
    if (data.lockedForSeconds !== undefined) wrapped.lockedForSeconds = data.lockedForSeconds;
    if (data.attemptsRemaining !== undefined) wrapped.attemptsRemaining = data.attemptsRemaining;
    // Which field a refusal belongs to, so a form can put the message beside
    // the box that caused it instead of in a corner toast.
    if (data.field) wrapped.field = data.field;
    return Promise.reject(wrapped);
  }
);
