import { financialYearOf, financialYearRange, defaultFinancialYear } from '../lib/financialYear.js';

// Categories used to be one flat set per user, so a single "Tooling" row was
// shared by every year at once. Splitting them by year means each year's row
// has to exist before anything can point at it — this walks each user's
// categories, keeps the earliest year on the original row, and clones it
// forward for every other year that actually has expenses in it.
//
// Runs once, guarded by a settings flag, because it repoints expenses.
export async function migrateCategoriesByYear(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'categories_split_by_year'`);
  if (flag.length > 0) return { skipped: true };

  const [categories] = await pool.execute(
    `SELECT id, user_id, name, color, icon, is_property_rental FROM categories WHERE financial_year IS NULL`
  );

  let placed = 0;
  let cloned = 0;
  let repointed = 0;

  for (const category of categories) {
    const [rows] = await pool.execute(
      `SELECT DISTINCT purchase_date FROM expenses WHERE category_id = ? ORDER BY purchase_date`,
      [category.id]
    );

    const years = Array.from(new Set(rows.map((r) => financialYearOf(r.purchase_date)).filter(Boolean))).sort();

    // Nothing filed against it yet, so it simply belongs to the year it would
    // next be used in.
    if (years.length === 0) {
      await pool.execute('UPDATE categories SET financial_year = ? WHERE id = ?', [
        defaultFinancialYear(),
        category.id,
      ]);
      placed += 1;
      continue;
    }

    const [first, ...rest] = years;
    await pool.execute('UPDATE categories SET financial_year = ? WHERE id = ?', [first, category.id]);
    placed += 1;

    for (const year of rest) {
      const range = financialYearRange(year);
      if (!range) continue;

      // A clone may already exist if this ran and was interrupted.
      const [existing] = await pool.execute(
        'SELECT id FROM categories WHERE user_id = ? AND name = ? AND financial_year = ?',
        [category.user_id, category.name, year]
      );

      let cloneId = existing[0]?.id;
      if (!cloneId) {
        const [result] = await pool.execute(
          `INSERT INTO categories (user_id, name, color, icon, is_property_rental, financial_year)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [category.user_id, category.name, category.color, category.icon, category.is_property_rental, year]
        );
        cloneId = result.insertId;
        cloned += 1;
      }

      const [moved] = await pool.execute(
        `UPDATE expenses SET category_id = ?
         WHERE category_id = ? AND purchase_date >= ? AND purchase_date <= ?`,
        [cloneId, category.id, range.start, range.end]
      );
      repointed += moved.affectedRows || 0;

      // A rental's paperwork is already filed by year, so it follows the year's
      // category rather than being stranded on the earliest one.
      await pool.execute('UPDATE category_documents SET category_id = ? WHERE category_id = ? AND financial_year = ?', [
        cloneId,
        category.id,
        year,
      ]);
    }
  }

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('categories_split_by_year', '1')`);

  if (placed > 0) {
    console.log(
      `[migration] categories by year: placed ${placed}, cloned ${cloned}, repointed ${repointed} expense(s)`
    );
  }
  return { placed, cloned, repointed };
}
