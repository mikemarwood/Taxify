// Categories that were seeded before they had a set of books to belong to.
//
// seedDefaultCategories used to insert without an entity_id, so those rows are
// NULL — and the categories list matches on `entity_id = ?`, which means they
// are invisible. That on its own would be untidy. What made it a dead end is
// that trying to recreate the defaults hit the unique key against the very rows
// nobody could see, and INSERT IGNORE dropped every one without a word: an
// empty Categories page that could not be repaired from the app.
//
// The cause is fixed at the seed. This places the rows already stranded.

export async function migrateCategoryEntities(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'category_entities_backfilled'`);
  if (flag.length > 0) return { skipped: true };

  // Their owner's default books — the same COALESCE the entities migration uses,
  // because categories.user_id is the login that created the row while an entity
  // belongs to the account holder.
  const [result] = await pool.execute(
    `UPDATE categories c
       JOIN users u ON u.id = c.user_id
       JOIN entities e ON e.user_id = COALESCE(u.account_holder_id, u.id) AND e.is_default = 1
     SET c.entity_id = e.id
     WHERE c.entity_id IS NULL`
  );

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('category_entities_backfilled', '1')`);

  if (result.affectedRows > 0) {
    console.log(`[migration] categories: placed ${result.affectedRows} that had no set of books`);
  }
  return { placed: result.affectedRows };
}
