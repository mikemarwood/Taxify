import { resolveBaseAmount } from '../lib/fx.js';

// Every expense that predates the conversion columns needs one, or it counts
// as zero in every total.
//
// Two cases, treated very differently:
//
//   Same currency as the account — pure arithmetic. rate 1, converted amount
//   equals the amount. Done in a single UPDATE, no network, no judgement.
//
//   Genuinely foreign — looked up at the published rate for that expense's own
//   purchase date, which is the basis a tax office asks for. Marked as a
//   fetched rate, not a stated one, so it is visible as something the app
//   worked out rather than something the person recorded. Anything that cannot
//   be resolved is left null and surfaced in the app for them to fill in;
//   inventing a rate on a tax record would be worse than an obvious gap.
//
// Guarded by a settings flag, like the other data migrations.
export async function migrateCurrencyBase(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'expenses_base_amount_backfilled'`);
  if (flag.length > 0) return { skipped: true };

  // The overwhelmingly common case: everything entered in the account's own
  // currency. One statement, whatever the size of the table.
  const [same] = await pool.execute(
    `UPDATE expenses e
     JOIN users u ON u.id = e.user_id
     SET e.base_currency = COALESCE(u.currency, 'AUD'),
         e.base_amount = e.amount,
         e.fx_rate = 1,
         e.fx_rate_source = 'same',
         e.fx_rate_date = e.purchase_date
     WHERE e.base_amount IS NULL AND e.currency = COALESCE(u.currency, 'AUD')`
  );

  // What is left is actually foreign, and needs a rate each.
  const [foreign] = await pool.execute(
    `SELECT e.id, e.amount, e.currency, e.purchase_date, COALESCE(u.currency, 'AUD') AS base_currency
     FROM expenses e JOIN users u ON u.id = e.user_id
     WHERE e.base_amount IS NULL
     ORDER BY e.purchase_date`
  );

  let converted = 0;
  let unresolved = 0;

  for (const row of foreign) {
    const money = await resolveBaseAmount({
      amount: Number(row.amount),
      currency: row.currency,
      baseCurrency: row.base_currency,
      purchaseDate: row.purchase_date,
    });

    if (money.error) {
      unresolved += 1;
      continue;
    }

    await pool.execute(
      `UPDATE expenses SET base_currency = ?, base_amount = ?, fx_rate = ?, fx_rate_source = ?, fx_rate_date = ?
       WHERE id = ?`,
      [money.baseCurrency, money.baseAmount, money.rate, money.source, money.rateDate, row.id]
    );
    converted += 1;
  }

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('expenses_base_amount_backfilled', '1')`);

  const domestic = same.affectedRows || 0;
  if (domestic || converted || unresolved) {
    console.log(
      `[migration] expense currency: ${domestic} already in the account currency, ` +
        `${converted} converted, ${unresolved} still need a rate`
    );
  }
  return { domestic, converted, unresolved };
}
