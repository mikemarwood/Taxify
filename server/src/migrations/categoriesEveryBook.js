// Every set of books gets every category the account already had.
//
// Categories have always had an entity_id and the list has always filtered by
// it, so they read as per-book. The unique key did not have entity_id in it,
// though, which made "Fuel" on the business and "Fuel" on the personal books
// the same row as far as the database was concerned: one of the two could
// exist and the other collided. Per-book in the reading, shared in the writing.
//
// With the key fixed, a second set of books can hold the same names — but the
// rows are not there. An account that built up thirty categories before it
// added a business finds that business holding whatever the default seed gave
// it and nothing else, and there is no screen anywhere that says "copy these
// across".
//
// So this is the one-off that carries them over. It runs once, guarded by a
// settings flag, and after it every book on an account has the union of every
// category that account had.

export async function migrateCategoriesEveryBook(pool) {
  const [flag] = await pool.query(
    `SELECT value FROM settings WHERE \`key\` = 'categories_copied_to_every_book'`
  );
  if (flag.length > 0) return { skipped: true };

  // Only accounts with more than one set of books have anything to copy. The
  // join is on the entity's owner rather than on categories.user_id, because a
  // category row is owned by the login that created it while a set of books
  // belongs to the account holder — the same distinction the entity backfill
  // had to make.
  const [pairs] = await pool.query(
    `SELECT DISTINCT c.user_id, e.id AS entity_id
       FROM categories c
       JOIN users u ON u.id = c.user_id
       JOIN entities e ON e.user_id = COALESCE(u.account_holder_id, u.id)
      WHERE c.entity_id IS NOT NULL
        AND e.archived_at IS NULL`
  );
  if (pairs.length === 0) {
    await pool.execute(
      `INSERT INTO settings (\`key\`, value) VALUES ('categories_copied_to_every_book', '1')`
    );
    return { copied: 0 };
  }

  let copied = 0;
  for (const { user_id: userId, entity_id: entityId } of pairs) {
    // One statement per book: everything this account has anywhere, that this
    // book does not have under the same name and year.
    //
    // Colour and icon come from the newest row with that name, so a category
    // that was recoloured at some point carries its current look rather than
    // whatever it started as. is_property_rental comes with it, because a
    // rental category without its document store is not the same category.
    const [result] = await pool.execute(
      `INSERT INTO categories (user_id, entity_id, name, color, icon, financial_year, is_property_rental)
       SELECT ?, ?, src.name, src.color, src.icon, src.financial_year, src.is_property_rental
         FROM categories src
         JOIN (
           SELECT name, financial_year, MAX(id) AS newest
             FROM categories
            WHERE user_id = ? AND entity_id IS NOT NULL
            GROUP BY name, financial_year
         ) pick ON pick.newest = src.id
        WHERE src.user_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM categories have
             WHERE have.user_id = ?
               AND have.entity_id = ?
               AND have.name = src.name
               AND (have.financial_year <=> src.financial_year)
          )`,
      [userId, entityId, userId, userId, userId, entityId]
    );
    copied += result.affectedRows;
  }

  await pool.execute(
    `INSERT INTO settings (\`key\`, value) VALUES ('categories_copied_to_every_book', '1')`
  );

  if (copied > 0) {
    console.log(`[migration] categories: copied ${copied} across sets of books`);
  }
  return { copied };
}
