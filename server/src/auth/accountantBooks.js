// Which sets of books an accountant may open, alongside which financial years.
//
// The convention matches financial_years exactly, and deliberately: NULL means
// all of them. An assignment made before this column existed granted every set
// of books, and has to keep granting every set of books — reading NULL as "none
// allowed" would lock out every accountant already working.
//
// The same trap financial years has applies here. "The client sent no list" and
// "every id in the client's list was rejected" arrive at the server looking the
// same, and treating both as NULL means somebody who picks three books and gets
// all three wrong silently grants everything. So the caller has to say which it
// means, and a list that reduces to nothing is an error rather than a shrug.

// Comfortably more books than any plan allows, so this only ever catches
// something malformed rather than a real choice.
const MAX_GRANTED_BOOKS = 50;

// A stored value to a list of numeric ids, or null for "all".
export function parseBooks(value) {
  if (!value) return null;
  const list = String(value)
    .split(',')
    .map((id) => Number(String(id).trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return list.length > 0 ? list : null;
}

// What the client sent, to what should be stored.
//
// Returns { ok: true, value } where value is null for all books, or a comma
// separated list. Returns { ok: false, error } when the intent cannot be read —
// never a quiet fallback to everything.
export function parseBookGrant(input, { availableIds = null } = {}) {
  if (input?.allBooks === true) return { ok: true, value: null };

  const raw = input?.entityIds;
  if (raw === undefined || raw === null) {
    // Nothing said at all. Older clients that predate this field mean "all",
    // which is what they have always granted.
    return { ok: true, value: null };
  }

  if (!Array.isArray(raw)) return { ok: false, error: 'Choose which books they can see' };

  const ids = [...new Set(raw.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return { ok: false, error: 'Choose at least one set of books, or give them all of them' };
  if (ids.length > MAX_GRANTED_BOOKS) return { ok: false, error: 'That is too many sets of books' };

  // Only the client's own books. Without this an id belonging to somebody else
  // could be stored, and while nothing reads it without checking ownership too,
  // a grant that names another account's books should never exist in the first
  // place.
  if (availableIds) {
    const owned = new Set(availableIds.map(Number));
    const stranger = ids.find((id) => !owned.has(id));
    if (stranger) return { ok: false, error: 'One of those sets of books is not yours' };
  }

  // Every book selected is the same grant as "all", and storing it as NULL
  // means adding a set of books later includes them rather than quietly
  // leaving the new one invisible.
  if (availableIds && ids.length === availableIds.length) return { ok: true, value: null };

  return { ok: true, value: ids.join(',') };
}

// Whether a set of books is inside the grant. The only question worth asking at
// read time, and the answer that must fail closed.
export function bookAllowed(allowedIds, entityId) {
  if (allowedIds === null || allowedIds === undefined) return true;
  if (!entityId) return true;
  return allowedIds.map(Number).includes(Number(entityId));
}

export { MAX_GRANTED_BOOKS };
