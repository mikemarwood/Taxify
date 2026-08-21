// Deleting an account, in the order the foreign keys actually demand.
//
// `users` cascades to `entities`, but five tables reference `entities(id)`
// with the default ON DELETE RESTRICT — expenses, categories, vehicle trips,
// home office hours and tax years. That was deliberate: it is the backstop for
// a bug in the application's own "this book still holds things" check, so that
// deleting a set of books can never quietly take a year of receipts with it.
//
// The side effect was that no account which had ever recorded an expense could
// be deleted at all. The cascade reached the entity row, found expenses still
// pointing at it, refused, and the whole DELETE failed with a foreign key
// error that reached the admin as "Something went wrong". An empty account
// deleted perfectly, which is what made it look random rather than a rule.
//
// So the rows come out deliberately, deepest first, and only then the user.
// The RESTRICT backstop is left exactly as strong as it was for every other
// route into deleting an entity — this is the one path that is allowed to mean
// it, and it says so by naming each table.

// Deepest first. Order matters: every one of these references entities(id),
// and entities cannot go until all five are clear.
export const ENTITY_CHILD_TABLES = [
  'expenses',
  'categories',
  'vehicle_trips',
  'home_office_hours',
  'tax_years',
];

// Ids are interpolated rather than bound, because `IN (?)` does not expand in
// a prepared statement. That is only safe because nothing but a positive
// integer survives the check below, and it throws rather than filtering — a
// silently dropped id would leave rows behind and report success.
function idList(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error('accountTeardown needs at least one user id');
  }
  const ids = userIds.map((value) => Number(value));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('accountTeardown needs positive integer user ids');
  }
  return [...new Set(ids)].join(', ');
}

// The statements to run, in order, inside one transaction.
//
// Each child is cleared both by its own user_id and by any entity belonging to
// these users. The two overlap almost entirely; the second half is what catches
// a row that ended up under somebody else's user_id through a bug, which would
// otherwise block the entity delete and put us straight back where we started.
export function accountTeardownStatements(userIds) {
  const ids = idList(userIds);
  const statements = ENTITY_CHILD_TABLES.map(
    (table) =>
      `DELETE FROM ${table} WHERE user_id IN (${ids}) ` +
      `OR entity_id IN (SELECT id FROM entities WHERE user_id IN (${ids}))`
  );
  statements.push(`DELETE FROM entities WHERE user_id IN (${ids})`);
  // Everything else hanging off users cascades cleanly, so the last statement
  // does the rest of the work on its own.
  statements.push(`DELETE FROM users WHERE id IN (${ids})`);
  return statements;
}

// A foreign key error out of the teardown means a table references entities or
// users that this file does not know about — a new feature that shipped without
// being added here. Say which constraint, because the generic message is what
// made the original bug take a bug report to find.
export function describeTeardownFailure(err) {
  const code = err && err.code;
  if (code !== 'ER_ROW_IS_REFERENCED' && code !== 'ER_ROW_IS_REFERENCED_2') return null;
  const constraint = /CONSTRAINT `([^`]+)`/.exec(err.sqlMessage || '');
  const named = constraint ? ` The constraint is ${constraint[1]}.` : '';
  return (
    'Something still references this account, so nothing was deleted and the ' +
    `account is intact.${named} This needs a developer — a table was added ` +
    'without being included in the account teardown.'
  );
}
