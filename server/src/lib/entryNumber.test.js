import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_ENTRY_NUMBER,
  NUMBERED_TABLES,
  orderForNumbering,
} from './entryNumber.js';

test('every reference is eight digits beginning 62', () => {
  assert.equal(FIRST_ENTRY_NUMBER, 62000000);
  assert.equal(String(FIRST_ENTRY_NUMBER).length, 8);
  assert.ok(String(FIRST_ENTRY_NUMBER).startsWith('62'));
  // And stays eight digits for a very long time. A sequence that grows a ninth
  // digit changes the shape of every reference printed after it.
  assert.equal(String(FIRST_ENTRY_NUMBER + 999999).length, 8);
});

test('all three kinds of entry share the sequence', () => {
  // The whole point: "entry 62000042" names one thing, not one of three.
  assert.deepEqual(NUMBERED_TABLES, ['expenses', 'vehicle_trips', 'home_office_hours']);
});

test('numbers follow when things happened, not which table they are in', () => {
  const ordered = orderForNumbering([
    { table: 'expenses', id: 9, occurredAt: '2026-03-01' },
    { table: 'home_office_hours', id: 1, occurredAt: '2026-01-15' },
    { table: 'vehicle_trips', id: 4, occurredAt: '2026-02-10' },
  ]);
  assert.deepEqual(
    ordered.map((r) => `${r.table}:${r.id}`),
    ['home_office_hours:1', 'vehicle_trips:4', 'expenses:9']
  );
});

test('a row id is never what decides the order', () => {
  // Three tables written at different times have unrelated id ranges. Ordering
  // by id would interleave a customer's records by which table happened to be
  // busy rather than by when anything actually happened.
  const ordered = orderForNumbering([
    { table: 'expenses', id: 5000, occurredAt: '2026-01-01' },
    { table: 'vehicle_trips', id: 2, occurredAt: '2026-06-01' },
  ]);
  assert.equal(ordered[0].id, 5000);
});

test('the same input always produces the same order', () => {
  // Running the backfill twice must not produce two different answers, or a
  // reference stops being a reference. Same day, so every tie-break is
  // exercised: table order first, then id.
  const rows = [
    { table: 'vehicle_trips', id: 2, occurredAt: '2026-04-01' },
    { table: 'expenses', id: 7, occurredAt: '2026-04-01' },
    { table: 'expenses', id: 3, occurredAt: '2026-04-01' },
    { table: 'home_office_hours', id: 1, occurredAt: '2026-04-01' },
  ];
  const once = orderForNumbering(rows).map((r) => `${r.table}:${r.id}`);
  const twice = orderForNumbering([...rows].reverse()).map((r) => `${r.table}:${r.id}`);
  assert.deepEqual(once, twice);
  assert.deepEqual(once, ['expenses:3', 'expenses:7', 'vehicle_trips:2', 'home_office_hours:1']);
});

test('ordering does not mutate what it was given', () => {
  const rows = [
    { table: 'expenses', id: 2, occurredAt: '2026-05-01' },
    { table: 'expenses', id: 1, occurredAt: '2026-01-01' },
  ];
  orderForNumbering(rows);
  assert.equal(rows[0].id, 2, 'the caller still holds its own array');
});

test('a missing or unreadable date sorts first rather than throwing', () => {
  // purchase_date is NOT NULL, but this walks three tables and one of them may
  // gain a nullable date later. Something entered before anybody recorded when
  // is older than everything, which is the least surprising answer.
  const ordered = orderForNumbering([
    { table: 'expenses', id: 2, occurredAt: '2026-01-01' },
    { table: 'expenses', id: 1, occurredAt: null },
  ]);
  assert.equal(ordered[0].id, 1);
});

