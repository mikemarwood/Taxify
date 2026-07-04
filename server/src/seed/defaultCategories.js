// Default categories every new user starts with, derived from Mike's real
// tax-tracking spreadsheets (General, Training, Tooling, Electronics, Home
// Rental sheets), plus generic Business/Other buckets for anyone else.
export const DEFAULT_CATEGORIES = [
  { name: 'General', color: '#8b5cf6', icon: 'receipt' },
  { name: 'Training', color: '#06b6d4', icon: 'graduation-cap' },
  { name: 'Tooling', color: '#f59e0b', icon: 'wrench' },
  { name: 'Electronics', color: '#ec4899', icon: 'cpu' },
  { name: 'Home Rental', color: '#10b981', icon: 'home' },
  { name: 'Business', color: '#3b82f6', icon: 'briefcase' },
  { name: 'Other', color: '#a1a1aa', icon: 'tag' },
];

export async function seedDefaultCategories(pool, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const c of DEFAULT_CATEGORIES) {
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
