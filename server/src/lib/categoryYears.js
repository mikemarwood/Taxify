import { isFinancialYearLabel, financialYearOf } from './financialYear.js';

// An expense must sit on its own year's category, or a 2024-2025 receipt would
// be counted against this year's books. Rather than rejecting a mismatch — the
// person picked the right name, just from the wrong year's list — the same
// category is found or created in the year the expense actually falls in.
//
// entityId is not optional. A category belongs to one set of books, and without
// it this would happily clone one business's "Tooling" into another's year —
// which is also the only thing enforcing that an expense and its category agree
// about which books they are in. The schema cannot express that: category_id is
// ON DELETE SET NULL, so the entity lives on the expense as well.
export async function resolveCategoryForYear(pool, userId, entityId, categoryId, purchaseDate, rule) {
  if (!categoryId) return null;

  const [rows] = await pool.execute(
    `SELECT id, name, color, icon, is_property_rental, financial_year, entity_id
     FROM categories WHERE id = ? AND user_id = ? AND (entity_id = ? OR entity_id IS NULL)`,
    [categoryId, userId, entityId]
  );
  const category = rows[0];
  if (!category) return undefined; // caller reports "Invalid category"

  const year = financialYearOf(purchaseDate, rule);
  if (!year) return category.id;
  if (category.financial_year === year && category.entity_id === entityId) return category.id;

  const [existing] = await pool.execute(
    'SELECT id FROM categories WHERE user_id = ? AND entity_id = ? AND name = ? AND financial_year = ?',
    [userId, entityId, category.name, year]
  );
  if (existing[0]) return existing[0].id;

  const [result] = await pool.execute(
    `INSERT INTO categories (user_id, entity_id, name, color, icon, is_property_rental, financial_year)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, entityId, category.name, category.color, category.icon, category.is_property_rental, year]
  );
  return result.insertId;
}

// A new financial year should open with the categories you were already using,
// not with an empty page — nobody wants to retype "Tooling" every July. The set
// is copied forward from the most recent year that has one, and only when the
// year being opened has none of its own, so a category deliberately deleted
// this year does not reappear tomorrow.
//
// Carried forward within one set of books. A brand-new business has no earlier
// year of its own, and rather than falling through to the personal defaults —
// which is how a plumbing business ends up with a "Home Rental" category — it
// is seeded explicitly when it is created. So this returns nothing for it.
export async function ensureCategoriesForYear(pool, userId, entityId, financialYear) {
  if (!isFinancialYearLabel(financialYear)) return { created: 0 };

  const [own] = await pool.execute(
    'SELECT COUNT(*) AS n FROM categories WHERE user_id = ? AND entity_id = ? AND financial_year = ?',
    [userId, entityId, financialYear]
  );
  if (Number(own[0]?.n) > 0) return { created: 0 };

  // Only ever carried forward, never back: opening 2019-2020 to look at old
  // records should not seed it with categories invented years later.
  const [previous] = await pool.execute(
    `SELECT financial_year FROM categories
     WHERE user_id = ? AND entity_id = ? AND financial_year IS NOT NULL AND financial_year < ?
     ORDER BY financial_year DESC LIMIT 1`,
    [userId, entityId, financialYear]
  );
  const source = previous[0]?.financial_year;

  if (source) {
    const [result] = await pool.execute(
      `INSERT IGNORE INTO categories (user_id, entity_id, name, color, icon, is_property_rental, financial_year)
       SELECT user_id, entity_id, name, color, icon, is_property_rental, ?
       FROM categories WHERE user_id = ? AND entity_id = ? AND financial_year = ?`,
      [financialYear, userId, entityId, source]
    );
    return { created: result.affectedRows || 0, copiedFrom: source };
  }

  // Only the account's original books fall back to the admin-managed defaults.
  // Anything else was seeded when it was created.
  const [[isDefault]] = await pool.execute('SELECT is_default FROM entities WHERE id = ?', [entityId]);
  if (!isDefault?.is_default) return { created: 0 };

  const [result] = await pool.execute(
    `INSERT IGNORE INTO categories (user_id, entity_id, name, color, icon, financial_year)
     SELECT ?, ?, name, color, icon, ? FROM default_categories`,
    [userId, entityId, financialYear]
  );
  return { created: result.affectedRows || 0, copiedFrom: 'defaults' };
}
