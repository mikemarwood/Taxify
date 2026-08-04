import { dataOwnerId } from '../auth/access.js';
import { entityFor, ensureDefaultEntity } from './entities.js';

// Which set of books a request is about.
//
// The app sets a header on every request it makes, because a header cannot be
// forgotten at a call site the way a query parameter can — and silently
// answering about the wrong books is the failure this codebase keeps having to
// design against. Downloads are the exception: an <a href> cannot set a header,
// so those carry ?entityId= instead and their routes refuse to guess.
//
// Absent means the combined view: every set of books at once. That is a way of
// looking, not a place to file, so writes refuse it (see writeEntityId).

export const ENTITY_HEADER = 'x-taxify-entity';

export async function resolveRequestEntity(req) {
  const ownerId = dataOwnerId(req.user);
  if (!ownerId) return { id: null, entity: null };

  const raw = req.get(ENTITY_HEADER) || req.query?.entityId || null;
  if (!raw || raw === 'all') return { id: null, entity: null };

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { id: null, entity: null, invalid: true };

  // Checked against the account holder, not the login. Checking req.user.id
  // would stop an accountant opening their client's books and stop a family
  // member seeing the shared ones; checking nothing at all would let any signed
  // in person name any entity in the database.
  const entity = await entityFor(ownerId, id);
  if (!entity) return { id: null, entity: null, invalid: true };

  return { id: entity.id, entity };
}

// The books a write lands in when the request did not say. Only ever the
// account's own default — never the first row, and never a guess.
export async function defaultWriteEntity(req) {
  const ownerId = dataOwnerId(req.user);
  if (!ownerId) return null;
  return ensureDefaultEntity(ownerId);
}
