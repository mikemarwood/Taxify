import { randomInt } from 'node:crypto';

// The number a person sees for their account.
//
// It is deliberately NOT users.id. That column is the primary key ten tables
// point at with foreign keys, it is the first segment of every receipt's path
// on disk, and it is what a signed-in session carries — renumbering it would
// mean rewriting all three together, and getting any one of them wrong loses
// somebody's receipts. This is a second, public number instead: nothing joins
// on it, so it can be whatever we like.
//
// Sequential ids leak how many customers there are and how fast that is
// growing, which is the actual reason to stop showing them.

const MIN = 10_000_000;
const MAX = 99_999_999;

// Always eight digits — never a leading zero, so it cannot be mistaken for a
// shorter number or mangled by a spreadsheet.
export function generateAccountNumber() {
  return String(randomInt(MIN, MAX + 1));
}

export function isAccountNumber(value) {
  return /^[1-9]\d{7}$/.test(String(value ?? ''));
}

// Retries on the unique key rather than checking first. At eight digits a
// collision is rare, and asking the database "is this taken" before inserting
// is a race whatever the odds — two signups can both be told no.
export async function assignAccountNumber(pool, userId, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const candidate = generateAccountNumber();
    try {
      const [result] = await pool.execute(
        'UPDATE users SET account_number = ? WHERE id = ? AND account_number IS NULL',
        [candidate, userId]
      );
      // Nothing updated means it already had one — read it rather than
      // overwriting, so this is safe to call twice.
      if (result.affectedRows === 0) {
        const [rows] = await pool.execute('SELECT account_number FROM users WHERE id = ?', [userId]);
        return rows[0]?.account_number || null;
      }
      return candidate;
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error(`Could not find a free account number for user ${userId} after ${attempts} tries`);
}
