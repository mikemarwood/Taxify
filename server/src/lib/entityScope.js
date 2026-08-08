import { dataOwnerId } from '../auth/access.js';
import { bookAllowed } from '../auth/accountantBooks.js';
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

  // No books named means the combined view of everything — which is exactly
  // what somebody given only one of three sets of books must never get. The
  // guard further down cannot help here: there is no id to refuse, and
  // returning null would aggregate the lot.
  //
  // Narrowed to the first book they were actually given instead of refused,
  // so an accountant landing on a page before choosing anything still sees
  // something, and only ever something they are allowed to see.
  const allowed = req.user?.allowedEntityIds;
  if (!raw || raw === 'all') {
    if (allowed && allowed.length > 0) {
      const first = await entityFor(ownerId, allowed[0]);
      if (first) return { id: first.id, entity: first };
      // Named in the grant but gone since — deleted, or never theirs. Refused
      // rather than widened.
      return { id: null, entity: null, invalid: true };
    }
    return { id: null, entity: null };
  }

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { id: null, entity: null, invalid: true };

  // Checked against the account holder, not the login. Checking req.user.id
  // would stop an accountant opening their client's books and stop a family
  // member seeing the shared ones; checking nothing at all would let any signed
  // in person name any entity in the database.
  const entity = await entityFor(ownerId, id);
  if (!entity) return { id: null, entity: null, invalid: true };

  // An accountant may have been given only some of the client's books. Refused
  // here rather than in each route, for the same reason the ownership check
  // above lives here: a route written next year is scoped whether or not its
  // author knew this rule existed.
  //
  // Refused as invalid rather than falling back to "all", which is what the
  // no-header path means — quietly widening a narrowed grant into the combined
  // view of everything would be precisely the leak this prevents.
  if (!bookAllowed(req.user?.allowedEntityIds, entity.id)) {
    return { id: null, entity: null, invalid: true };
  }

  return { id: entity.id, entity };
}

// The books a write lands in when the request did not say. Only ever the
// account's own default — never the first row, and never a guess.
export async function defaultWriteEntity(req) {
  const ownerId = dataOwnerId(req.user);
  if (!ownerId) return null;
  return ensureDefaultEntity(ownerId);
}
