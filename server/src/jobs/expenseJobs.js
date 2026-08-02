import { advanceDate } from '../lib/recurrence.js';
import { resolveBaseAmount } from '../lib/fx.js';
import { notify } from '../lib/notify.js';

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
  // Counted per person, so someone paying five monthly subscriptions gets one
  // notification rather than five.
  const added = new Map();

  for (const t of templates) {
    let nextDue = t.next_due_date instanceof Date ? t.next_due_date.toISOString().slice(0, 10) : t.next_due_date;
    let iterations = 0;

    while (nextDue && nextDue <= today && iterations < MAX_CATCHUP_ITERATIONS) {
      // Each occurrence is converted at its own date rather than the template's:
      // a subscription billed in USD costs a different number of dollars every
      // month, and that difference is the entire reason a rate is stored.
      //
      // When the rate can't be fetched the occurrence is still created, with a
      // NULL base_amount — exactly like a manual entry that needs one. It then
      // appears in the "needs an exchange rate" list rather than vanishing. A
      // missing rate must never quietly cost someone a deduction.
      const money = await resolveBaseAmount({
        amount: Number(t.amount),
        currency: t.currency,
        baseCurrency: t.base_currency || t.currency,
        purchaseDate: nextDue,
      });

      await pool.execute(
        `INSERT INTO expenses (user_id, created_by, category_id, item_name, amount, currency, purchase_date,
           is_recurring, frequency, notes, auto_generated,
           base_currency, base_amount, fx_rate, fx_rate_source, fx_rate_date, business_use_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [
          t.user_id,
          t.created_by || t.user_id,
          t.category_id,
          t.item_name,
          t.amount,
          t.currency,
          nextDue,
          t.notes,
          money.error ? t.base_currency || t.currency : money.baseCurrency,
          money.error ? null : money.baseAmount,
          money.error ? null : money.rate,
          money.error ? null : money.source,
          money.error ? null : money.rateDate,
          // Part of how the expense is claimed, so it carries forward with
          // everything else. Without this every occurrence silently reverted to
          // a 100% business claim.
          t.business_use_pct ?? 100,
        ]
      );

      added.set(t.user_id, (added.get(t.user_id) || 0) + 1);
      nextDue = advanceDate(nextDue, t.frequency);
      iterations++;
    }

    await pool.execute('UPDATE expenses SET next_due_date = ? WHERE id = ?', [nextDue, t.id]);
  }

  for (const [userId, count] of added) {
    await notify(userId, {
      title: count === 1 ? 'A recurring expense was added' : `${count} recurring expenses were added`,
      body: 'Added from your recurring templates. Open Expenses to check them.',
      url: '/expenses',
      kind: 'recurring',
    });
  }
}
