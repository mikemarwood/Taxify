import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nameProblem,
  companyProblem,
  inviteFieldsProblem,
  tidy,
  NAME_MIN,
  NAME_MAX,
  COMPANY_MAX,
} from './inviteFields.js';

test('a name at the floor is accepted', () => {
  assert.equal(nameProblem('Li'), '');
});

test('a single letter is refused, and says so by name', () => {
  assert.equal(nameProblem('L', 'First name'), `First name needs at least ${NAME_MIN} characters`);
});

test('whitespace cannot pad a name past the floor', () => {
  // Without the collapse, "L " is two characters and walks straight through
  // the length check.
  assert.equal(nameProblem('L '), `Name needs at least ${NAME_MIN} characters`);
  assert.equal(tidy('  Anne   Marie  '), 'Anne Marie');
});

test('an empty name is required rather than too short', () => {
  // Two different problems and two different fixes: one needs typing into,
  // the other needs typing more into.
  assert.equal(nameProblem('   ', 'Last name'), 'Last name is required');
});

test('a name at the ceiling is accepted and one past it is not', () => {
  assert.equal(nameProblem('a'.repeat(NAME_MAX)), '');
  assert.equal(nameProblem('a'.repeat(NAME_MAX + 1)), `Name can be at most ${NAME_MAX} characters`);
});

test('no company is fine, because the field is optional', () => {
  assert.equal(companyProblem(''), '');
  assert.equal(companyProblem('   '), '');
});

test('a company that is given still has to be plausible', () => {
  assert.notEqual(companyProblem('A'), '');
  assert.equal(companyProblem('a'.repeat(COMPANY_MAX + 1)), `Practice or firm name can be at most ${COMPANY_MAX} characters`);
});

test('the first problem across the set is the one reported', () => {
  assert.equal(
    inviteFieldsProblem({ firstName: 'A', lastName: 'B', companyName: 'C' }),
    `First name needs at least ${NAME_MIN} characters`
  );
});

test('a complete set has no problem', () => {
  assert.equal(inviteFieldsProblem({ firstName: 'Mike', lastName: 'Marwood', companyName: '' }), '');
});
