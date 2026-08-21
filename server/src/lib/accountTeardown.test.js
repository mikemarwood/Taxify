import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITY_CHILD_TABLES,
  accountTeardownStatements,
  describeTeardownFailure,
} from './accountTeardown.js';

test('clears every table that references entities before the entities go', () => {
  const statements = accountTeardownStatements([7]);
  const entitiesAt = statements.findIndex((s) => s.startsWith('DELETE FROM entities'));
  assert.notEqual(entitiesAt, -1, 'entities must be deleted');
  for (const table of ENTITY_CHILD_TABLES) {
    const at = statements.findIndex((s) => s.startsWith(`DELETE FROM ${table} `));
    assert.notEqual(at, -1, `${table} must be cleared`);
    assert.ok(at < entitiesAt, `${table} must be cleared before entities`);
  }
});

test('deletes the user last, once nothing points at them', () => {
  const statements = accountTeardownStatements([7]);
  assert.ok(statements[statements.length - 1].startsWith('DELETE FROM users'));
});

test('catches rows filed under an entity but a different user id', () => {
  // The half that matters: a row whose user_id drifted would still block the
  // entity delete, and the account would be undeletable all over again.
  const [expenses] = accountTeardownStatements([7]);
  assert.match(expenses, /entity_id IN \(SELECT id FROM entities WHERE user_id IN \(7\)\)/);
});

test('takes several ids at once, for an account with linked logins', () => {
  const statements = accountTeardownStatements([7, 9]);
  assert.ok(statements[statements.length - 1].includes('IN (7, 9)'));
});

test('collapses a repeated id rather than listing it twice', () => {
  const statements = accountTeardownStatements([7, 7]);
  assert.ok(statements[statements.length - 1].includes('IN (7)'));
});

test('refuses anything that is not a positive integer id', () => {
  // Interpolated straight into SQL, so this check is the only thing standing
  // between a bad caller and an injection.
  for (const bad of [['1; DROP TABLE users'], ['abc'], [0], [-3], [1.5], [null], [undefined]]) {
    assert.throws(() => accountTeardownStatements(bad), /positive integer/);
  }
});

test('refuses an empty list rather than deleting nothing and reporting success', () => {
  assert.throws(() => accountTeardownStatements([]), /at least one/);
  assert.throws(() => accountTeardownStatements(null), /at least one/);
});

test('names the constraint when a foreign key still blocks the delete', () => {
  const message = describeTeardownFailure({
    code: 'ER_ROW_IS_REFERENCED_2',
    sqlMessage: 'Cannot delete or update a parent row: a foreign key constraint fails (`taxify`.`invoices`, CONSTRAINT `fk_invoices_entity` FOREIGN KEY (`entity_id`) REFERENCES `entities` (`id`))',
  });
  assert.match(message, /fk_invoices_entity/);
  assert.match(message, /account is intact/);
});

test('says the account survived, because that is the part worth knowing', () => {
  const message = describeTeardownFailure({ code: 'ER_ROW_IS_REFERENCED', sqlMessage: '' });
  assert.match(message, /nothing was deleted/);
});

test('leaves any other error alone for the normal handler', () => {
  assert.equal(describeTeardownFailure({ code: 'ER_LOCK_DEADLOCK' }), null);
  assert.equal(describeTeardownFailure(new Error('boom')), null);
  assert.equal(describeTeardownFailure(null), null);
});
