// "Both" stops being a third list and becomes two rows.
//
// The kind started as individual, business or both, and both was for the
// handful — General, Other — that belong on either. As a data model that is
// tidy; as a screen it is a third section an administrator has to reason about
// before they can answer "what does a new business start with", and the answer
// is always the union of two of the three.
//
// So the union is written down instead. Every 'both' row becomes a personal row
// and a business row, and after this there are two lists that each say exactly
// what a new set of books gets — no arithmetic.
//
// Editing one afterwards no longer changes the other, which is the trade and is
// the right way round: a business list and a personal list that move together
// are one list wearing two labels.
export async function migrateSplitBothCategories(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'default_categories_both_split'`);
  if (flag.length > 0) return { skipped: true };

  const [both] = await pool.query(`SELECT id, name, color, icon FROM default_categories WHERE kind = 'both'`);
  if (both.length === 0) {
    await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('default_categories_both_split', '1')`);
    return { split: 0 };
  }

  let made = 0;
  for (const row of both) {
    // The business copy first. IGNORE because the business list may already
    // have a row of that name — General is exactly the case — and that row is
    // somebody's own edit, which wins.
    const [copy] = await pool.execute(
      `INSERT IGNORE INTO default_categories (name, color, icon, kind) VALUES (?, ?, ?, 'business')`,
      [row.name, row.color, row.icon]
    );
    made += copy.affectedRows;

    // Then the original becomes the personal one. Same reasoning: if a personal
    // row of that name already exists this one is a duplicate and goes, rather
    // than colliding with the key.
    try {
      await pool.execute(`UPDATE default_categories SET kind = 'individual' WHERE id = ?`, [row.id]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        await pool.execute(`DELETE FROM default_categories WHERE id = ?`, [row.id]);
      } else {
        throw err;
      }
    }
  }

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('default_categories_both_split', '1')`);
  console.log(`[migration] default categories: split ${both.length} shared row(s) across the two lists`);
  return { split: both.length, made };
}
