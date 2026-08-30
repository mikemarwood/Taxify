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
// Eight digits from 62000000, so every reference reads 62xxxxxx. A starting
// point chosen to look like a reference rather than a row count. It is not a
// secret and does not need to be: it says nothing except the order things were
// entered in.
//
// It began at 61320000 and was moved here, which meant renumbering everything
// already issued. Worth doing once, immediately, and not again: a reference is
// only useful if it is the same reference tomorrow, and every renumbering
// invalidates whatever anybody has already written down or quoted at support.
//
// The connection is passed in rather than imported. db.js runs the backfill,
// so importing the pool from here would be a cycle — and it would make every
// test of this file open a database it does not need.

export const FIRST_ENTRY_NUMBER = 62000000;

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

const DATE_COLUMN = {
  expenses: 'purchase_date',
  vehicle_trips: 'trip_date',
  home_office_hours: 'entry_date',
};

// The order numbers are handed out in.
//
// By when the thing happened, not by row id, so the sequence reads as the
// order a customer's records occurred in rather than the order three separate
// tables happened to be written to. Ties break on table then id: arbitrary,
// but stable — running this twice must never produce two different answers,
// which is the difference between a reference and a row count.
//
// Split out from the query so the ordering can be tested without a database,
// since the ordering is the only part with a decision in it.
export function orderForNumbering(rows) {
  return [...rows].sort((a, b) => {
    const left = new Date(a.occurredAt).getTime() || 0;
    const right = new Date(b.occurredAt).getTime() || 0;
    if (left !== right) return left - right;
    if (a.table !== b.table) return NUMBERED_TABLES.indexOf(a.table) - NUMBERED_TABLES.indexOf(b.table);
    return a.id - b.id;
  });
}

// Gives a number to everything that has not got one in the current range.
//
// Two cases, deliberately handled by one query. A row with no number at all is
// something entered before any of this existed. A row numbered below
// FIRST_ENTRY_NUMBER is one issued under the old 61320000 start, and it is
// renumbered into the new range so that every reference in the system reads
// 62xxxxxx rather than the set being split across two schemes.
//
// Idempotent by that condition rather than by a settings flag: a flag can be
// written while the work is half finished, and a comparison cannot. After the
// first run nothing matches and this does nothing at all.
//
// Safe against collision because every number the sequence issues is at or
// above FIRST_ENTRY_NUMBER and every number being replaced is below it, so no
// row is ever updated to a value another row still holds.
export async function backfillEntryNumbers(executor) {
  const pending = [];
  for (const table of NUMBERED_TABLES) {
    const [rows] = await executor.query(
      `SELECT id, ${DATE_COLUMN[table]} AS occurred_at
         FROM ${table}
        WHERE entry_no IS NULL OR entry_no < ?`,
      [FIRST_ENTRY_NUMBER]
    );
    for (const row of rows) pending.push({ table, id: row.id, occurredAt: row.occurred_at });
  }
  if (!pending.length) return 0;

  for (const row of orderForNumbering(pending)) {
    const number = await nextEntryNumber(executor);
    await executor.execute(
      `UPDATE ${row.table} SET entry_no = ? WHERE id = ? AND (entry_no IS NULL OR entry_no < ?)`,
      [number, row.id, FIRST_ENTRY_NUMBER]
    );
  }
  return pending.length;
}

