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
  async (err) => {
    const data = err?.response?.data || {};

    // A book id that no longer belongs to this account.
    //
    // The server refuses these rather than widening them to "everything", which
    // is right — but the refusal used to reach the page as an error with no way
    // out. An accountant switching between a client's books and their own could
    // land on a stale id, and every request including the one that fetches the
    // correct list was refused with it, so the app could not recover on its
    // own: it just said the books were not theirs until local storage was
    // cleared by hand.
    //
    // Dropping the header and retrying once fixes it in place. Without a header
    // the server picks the right books itself — the account's own, or the first
    // one an accountant was granted — so the retry is the same request asked
    // properly. Marked so a second failure is reported rather than looped.
    if (data.error === 'entity_not_yours' && err.config && !err.config.__entityRetried) {
      entityId = null;
      // Cleared everywhere, not just for this request: every other call in
      // flight is carrying the same dead id.
      try {
        for (const key of Object.keys(window.localStorage)) {
          if (key.startsWith('taxify.entity.')) window.localStorage.removeItem(key);
        }
      } catch {
        // Private browsing, or storage disabled. The in-memory clear above is
        // the part that matters.
      }
      const retry = { ...err.config, __entityRetried: true };
      delete retry.headers['X-Taxify-Entity'];
      return api.request(retry);
    }

    // The raw key reached the screen as "entity_not_yours" if the retry above
    // could not save it. Nobody should be shown a column name.
    const message =
      data.error === 'entity_not_yours'
        ? 'Those books are not on this account. Pick a set of books and try again.'
        : data.error || 'Something went wrong. Please try again.';
    const wrapped = new Error(message);
    if (data.lockedUntil) wrapped.lockedUntil = data.lockedUntil;
    if (data.lockedForSeconds !== undefined) wrapped.lockedForSeconds = data.lockedForSeconds;
    if (data.attemptsRemaining !== undefined) wrapped.attemptsRemaining = data.attemptsRemaining;
    // How long a rate-limited action has left, so a countdown can show the
    // server's answer rather than this browser's guess at it.
    if (data.retryAfterSeconds !== undefined) wrapped.retryAfterSeconds = data.retryAfterSeconds;
    // Which field a refusal belongs to, so a form can put the message beside
    // the box that caused it instead of in a corner toast.
    if (data.field) wrapped.field = data.field;
    // A machine-readable name for the refusal, where there is one, so a page
    // can do something about it rather than only say it. This wrapper used to
    // keep the sentence and drop everything else, which is why a refusal a
    // page knew how to handle arrived as a string it could only toast.
    if (data.code) wrapped.code = data.code;
    if (data.missing) wrapped.missing = data.missing;
    return Promise.reject(wrapped);
  }
);
