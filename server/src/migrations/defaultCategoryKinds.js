// The business list, put where an administrator can see it.
//
// There were three starter lists and only one was editable. default_categories
// fed an account's very first set of books; a hard-coded pair in
// entities.routes.js fed every book created afterwards — one list for a
// business, one for personal — and neither appeared anywhere in the admin
// panel. So the list an administrator *could* edit reached only the first book
// on an account, and editing it changed nothing about the rest.
//
// This puts the hard-coded business set into the table, tagged, so both lists
// are in one place and both are editable. Existing rows keep 'both', which is
// what they were written as when there was no distinction to make.

const BUSINESS_DEFAULTS = [
  ['General', '#8b5cf6', 'receipt'],
  ['Tools & Equipment', '#f59e0b', 'wrench'],
  ['Vehicle & Travel', '#3b82f6', 'car'],
  ['Software & Subscriptions', '#06b6d4', 'cpu'],
  ['Materials', '#10b981', 'box'],
];

const INDIVIDUAL_DEFAULTS = [
  ['Work Related', '#3b82f6', 'briefcase'],
  ['Education', '#06b6d4', 'graduation-cap'],
];

export async function migrateDefaultCategoryKinds(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'default_category_kinds_seeded'`);
  if (flag.length > 0) return { skipped: true };

  let added = 0;
  for (const [kind, rows] of [
    ['business', BUSINESS_DEFAULTS],
    ['individual', INDIVIDUAL_DEFAULTS],
  ]) {
    for (const [name, color, icon] of rows) {
      // IGNORE rather than a lookup: the unique key is (kind, name), so a row
      // an administrator has already made by hand wins and this adds nothing.
      // Their edit is the more recent decision.
      const [result] = await pool.execute(
        `INSERT IGNORE INTO default_categories (name, color, icon, kind) VALUES (?, ?, ?, ?)`,
        [name, color, icon, kind]
      );
      added += result.affectedRows;
    }
  }

  await pool.execute(
    `INSERT INTO settings (\`key\`, value) VALUES ('default_category_kinds_seeded', '1')`
  );

  if (added > 0) {
    console.log(`[migration] default categories: added ${added} to the per-kind lists`);
  }
  return { added };
}
