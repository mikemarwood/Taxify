import { advanceDate } from '../lib/recurrence.js';

// Bounds how many missed periods a single stale recurring template can back-
// fill in one job run (e.g. if the server was down for a long time).
const MAX_CATCHUP_ITERATIONS = 24;

export async function runRecurringExpenses(pool) {
  const [templates] = await pool.execute(
    `SELECT * FROM expenses
     WHERE is_recurring = 1 AND deleted_at IS NULL AND next_due_date IS NOT NULL
       AND next_due_date <= CURDATE()`
  );

  const today = new Date().toISOString().slice(0, 10);

  for (const t of templates) {
    let nextDue = t.next_due_date instanceof Date ? t.next_due_date.toISOString().slice(0, 10) : t.next_due_date;
    let iterations = 0;

    while (nextDue && nextDue <= today && iterations < MAX_CATCHUP_ITERATIONS) {
      await pool.execute(
        `INSERT INTO expenses (user_id, category_id, item_name, amount, currency, purchase_date, is_recurring, frequency, notes, auto_generated)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, 1)`,
        [t.user_id, t.category_id, t.item_name, t.amount, t.currency, nextDue, t.notes]
      );
      nextDue = advanceDate(nextDue, t.frequency);
      iterations++;
    }

    await pool.execute('UPDATE expenses SET next_due_date = ? WHERE id = ?', [nextDue, t.id]);
  }
}
