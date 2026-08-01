import { financialYearRange, financialYearOf } from './financialYear.js';

// An expense must sit on its own year's category, or a 2024-2025 receipt would
// be counted against this year's books. Rather than rejecting a mismatch — the
// person picked the right name, just from the wrong year's list — the same
// category is found or created in the year the expense actually falls in.
export async function resolveCategoryForYear(pool, userId, categoryId, purchaseDate) {
  if (!categoryId) return null;

  const [rows] = await pool.execute(
    'SELECT id, name, color, icon, is_property_rental, financial_year FROM categories WHERE id = ? AND user_id = ?',
    [categoryId, userId]
  );
  const category = rows[0];
  if (!category) return undefined; // caller reports "Invalid category"

  const year = financialYearOf(purchaseDate);
  if (!year || category.financial_year === year) return category.id;

  const [existing] = await pool.execute(
    'SELECT id FROM categories WHERE user_id = ? AND name = ? AND financial_year = ?',
    [userId, category.name, year]
  );
  if (existing[0]) return existing[0].id;

  const [result] = await pool.execute(
    `INSERT INTO categories (user_id, name, color, icon, is_property_rental, financial_year)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, category.name, category.color, category.icon, category.is_property_rental, year]
  );
  return result.insertId;
}

// A new financial year should open with the categories you were already using,
// not with an empty page — nobody wants to retype "Tooling" every July. The set
// is copied forward from the most recent year that has one, and only when the
// year being opened has none of its own, so a category deliberately deleted
// this year does not reappear tomorrow.
//
// Falls back to the admin-managed defaults for someone whose account has no
// categories at all.
export async function ensureCategoriesForYear(pool, userId, financialYear) {
  if (!financialYearRange(financialYear)) return { created: 0 };

  const [own] = await pool.execute('SELECT COUNT(*) AS n FROM categories WHERE user_id = ? AND financial_year = ?', [
    userId,
    financialYear,
  ]);
  if (Number(own[0]?.n) > 0) return { created: 0 };

  // Only ever carried forward, never back: opening 2019-2020 to look at old
  // records should not seed it with categories invented years later.
  const [previous] = await pool.execute(
    `SELECT financial_year FROM categories
     WHERE user_id = ? AND financial_year IS NOT NULL AND financial_year < ?
     ORDER BY financial_year DESC LIMIT 1`,
    [userId, financialYear]
  );
  const source = previous[0]?.financial_year;

  if (source) {
    const [result] = await pool.execute(
      `INSERT IGNORE INTO categories (user_id, name, color, icon, is_property_rental, financial_year)
       SELECT user_id, name, color, icon, is_property_rental, ?
       FROM categories WHERE user_id = ? AND financial_year = ?`,
      [financialYear, userId, source]
    );
    return { created: result.affectedRows || 0, copiedFrom: source };
  }

  const [result] = await pool.execute(
    `INSERT IGNORE INTO categories (user_id, name, color, icon, financial_year)
     SELECT ?, name, color, icon, ? FROM default_categories`,
    [userId, financialYear]
  );
  return { created: result.affectedRows || 0, copiedFrom: 'defaults' };
}
