// One number across everything a customer enters.
//
// An expense, a vehicle trip and an hour worked from home are three tables
// with three auto-increment ids, so "number 14" meant three different things
// depending on which list you were looking at. This gives all three one
// sequence: whoever enters the next thing gets the next number, whatever kind
// of thing it is and whoever they are.
//
// Deliberately global rather than per customer. A number that restarts at 1 for
// every account is not a reference — two people quoting "entry 26" in the same
// support ticket is the whole problem it exists to solve.
//
// Eight digits from 61320000, which is a starting point chosen to look like a
// reference rather than a row count. It is not a secret and does not need to
// be: it says nothing except the order things were entered in.
//
// The connection is passed in rather than imported. db.js runs the backfill,
// so importing the pool from here would be a cycle — and it would make every
// test of this file open a database it does not need.

export const FIRST_ENTRY_NUMBER = 61320000;

// The three tables that share it, in the order a backfill should walk them.
export const NUMBERED_TABLES = ['expenses', 'vehicle_trips', 'home_office_hours'];

// Allocation goes through a table whose AUTO_INCREMENT is the sequence.
//
// MariaDB has no portable sequence object here, and the obvious alternative —
// read a counter, add one, write it back — is not atomic: two people saving an
// expense in the same instant read the same number and one of them is
// overwritten. An INSERT is atomic by definition, and insertId is the number
// nobody else can have been given.
//
// The rows are kept rather than deleted. They are eight bytes each, and having
// them means a number that appears twice, or a gap nobody expected, can be
// traced afterwards instead of argued about.
export async function nextEntryNumber(executor) {
  const [result] = await executor.execute('INSERT INTO entry_numbers () VALUES ()');
  return result.insertId;
}

// Gives every existing row a number, oldest first.
//
// Ordered by when the thing happened rather than by row id, so the sequence
// reads as the order the customer's records occurred in and not the order three
// separate tables were written to. Ties break on table then id, which is
// arbitrary but stable — running this twice must not produce two answers.
//
// Idempotent: only rows without a number are touched, so it is safe on every
// boot and does nothing at all after the first.
export async function backfillEntryNumbers(executor) {
  const dateColumn = { expenses: 'purchase_date', vehicle_trips: 'trip_date', home_office_hours: 'entry_date' };

  const pending = [];
  for (const table of NUMBERED_TABLES) {
    const [rows] = await executor.query(
      `SELECT id, ${dateColumn[table]} AS occurred_at FROM ${table} WHERE entry_no IS NULL`
    );
    for (const row of rows) pending.push({ table, id: row.id, occurredAt: row.occurred_at });
  }
  if (!pending.length) return 0;

  pending.sort((a, b) => {
    const left = new Date(a.occurredAt).getTime() || 0;
    const right = new Date(b.occurredAt).getTime() || 0;
    if (left !== right) return left - right;
    if (a.table !== b.table) return NUMBERED_TABLES.indexOf(a.table) - NUMBERED_TABLES.indexOf(b.table);
    return a.id - b.id;
  });

  for (const row of pending) {
    const number = await nextEntryNumber(executor);
    await executor.execute(`UPDATE ${row.table} SET entry_no = ? WHERE id = ? AND entry_no IS NULL`, [
      number,
      row.id,
    ]);
  }
  return pending.length;
}

// How it is shown. One place, so three screens cannot format it three ways.
export function formatEntryNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return `#${value}`;
}
