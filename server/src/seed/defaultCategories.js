import { defaultFinancialYear } from '../lib/financialYear.js';

// One-time seed data used only to populate the `default_categories` table
// the very first time it's created (see ensureSchema in ../db.js). After
// that, the `default_categories` table itself is the source of truth and is
// editable via the admin panel — this constant is never read again.
export const INITIAL_DEFAULT_CATEGORIES = [
  { name: 'General', color: '#8b5cf6', icon: 'receipt' },
  { name: 'Training', color: '#06b6d4', icon: 'graduation-cap' },
  { name: 'Tooling', color: '#f59e0b', icon: 'wrench' },
  { name: 'Electronics', color: '#ec4899', icon: 'cpu' },
  { name: 'Home Rental', color: '#10b981', icon: 'home' },
  { name: 'Business', color: '#3b82f6', icon: 'briefcase' },
  { name: 'Other', color: '#a1a1aa', icon: 'tag' },
];

// The starter set every new account gets, filed against the year they signed
// up in. Later years carry it forward on their own — see ensureCategoriesForYear.
//
// entityId is not optional in practice. A category with no set of books is
// filtered out of every list, because the categories query matches on
// `entity_id = ?` — so seeding without one produced an account whose Categories
// page was empty *and* unrepairable: recreating the defaults hit the unique key
// against the rows nobody could see, and INSERT IGNORE dropped them silently.
export async function seedDefaultCategories(pool, userId, entityId, financialYear = defaultFinancialYear()) {
  const [templates] = await pool.execute('SELECT name, color, icon FROM default_categories');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const c of templates) {
      await connection.execute(
        'INSERT INTO categories (user_id, entity_id, name, color, icon, financial_year) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, entityId, c.name, c.color, c.icon, financialYear]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
