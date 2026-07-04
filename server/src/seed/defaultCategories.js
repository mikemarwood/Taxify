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

export async function seedDefaultCategories(pool, userId) {
  const [templates] = await pool.execute('SELECT name, color, icon FROM default_categories');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const c of templates) {
      await connection.execute(
        'INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)',
        [userId, c.name, c.color, c.icon]
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
