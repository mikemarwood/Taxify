// Giving every account a set of books to file into.
//
// Everything recorded so far belongs to one person doing one return, so it all
// moves into a single entity called "Individual" — which is what it always was,
// just now named. Nothing else changes: no amount is touched, no file moves,
// nothing is deleted.
//
// The order matters and is not negotiable. A unique key containing a NULL
// column constrains nothing, so the new keys are strictly weaker than the ones
// they replace until every row has an entity. The zero-NULL check before the
// swap is the correctness condition, not a precaution.
//
// Guarded by a settings flag, like the other data migrations.

const BACKFILL_TABLES = ['expenses', 'categories', 'vehicle_trips', 'home_office_hours', 'tax_years'];

async function countNulls(pool) {
  const counts = {};
  for (const table of BACKFILL_TABLES) {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE entity_id IS NULL`);
    counts[table] = Number(row.n || 0);
  }
  return counts;
}

async function indexNames(pool, table) {
  const [rows] = await pool.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.map((r) => r.INDEX_NAME);
}

async function hasConstraint(pool, name) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?`,
    [name]
  );
  return rows.length > 0;
}

export async function migrateEntities(pool) {
  const [flag] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'entities_backfilled'`);
  if (flag.length > 0) return { skipped: true };

  // --- One default entity per account ------------------------------------
  //
  // Driven by users, not by expenses, so an account with nothing recorded still
  // gets one and has somewhere to file its first receipt.
  //
  // account_holder_id IS NULL rather than role = 'owner': an accountant who
  // starts their own account keeps role 'accountant' with the holder cleared,
  // and would otherwise be left without an entity the moment they entered an
  // expense. One unused row for an accountant who never does is a fair price.
  const [created] = await pool.execute(
    `INSERT INTO entities (user_id, name, kind, lodgement_cadence, is_default, path_segment)
     SELECT u.id, 'Individual', 'individual', 'annual', 1, NULL
     FROM users u
     WHERE u.account_holder_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.user_id = u.id)`
  );

  // --- Place every existing row ------------------------------------------
  //
  // expenses.user_id and categories.user_id are the login that created the row,
  // while vehicle_trips, home_office_hours and tax_years already store the
  // account holder. The COALESCE handles both in one expression, so there is no
  // per-table special case to get wrong.
  //
  // WHERE entity_id IS NULL makes every statement resumable: if this dies
  // halfway through the largest table, the flag is never set and the next boot
  // finishes what is left rather than starting again.
  const placed = {};
  for (const table of BACKFILL_TABLES) {
    const [result] = await pool.execute(
      `UPDATE ${table} t
         JOIN users u ON u.id = t.user_id
         JOIN entities e ON e.user_id = COALESCE(u.account_holder_id, u.id) AND e.is_default = 1
       SET t.entity_id = e.id
       WHERE t.entity_id IS NULL`
    );
    placed[table] = result.affectedRows;
  }

  // --- Verify before touching a single key -------------------------------
  const remaining = await countNulls(pool);
  const stragglers = Object.entries(remaining).filter(([, n]) => n > 0);
  if (stragglers.length > 0) {
    // Deliberately leaves the flag unset so the next boot tries again. Swapping
    // the keys now would replace a constraint that works with one that does
    // nothing, and that is far worse than an unfinished migration.
    console.error(
      '[migration] entities: backfill incomplete, leaving the unique keys alone —',
      stragglers.map(([t, n]) => `${t}:${n}`).join(', ')
    );
    return { partial: true, created: created.affectedRows, placed, remaining };
  }

  // --- Swap the unique keys ----------------------------------------------
  //
  // categories was unique on (user_id, name, financial_year), which now has to
  // admit the same name once per set of books: two businesses may each have a
  // "Tooling" in the same year, and they are different categories.
  const categoryIndexes = await indexNames(pool, 'categories');
  if (!categoryIndexes.includes('uniq_categories_user_entity_name_year')) {
    // Look before leaping. A pre-existing duplicate would make the ADD fail
    // after the DROP has already happened, and it is much better to find that
    // out from a log line than from a half-applied migration.
    const [[dupes]] = await pool.query(
      `SELECT COUNT(*) AS n FROM (
         SELECT user_id, entity_id, name, financial_year
         FROM categories GROUP BY user_id, entity_id, name, financial_year HAVING COUNT(*) > 1
       ) d`
    );
    if (Number(dupes.n) > 0) {
      console.error(`[migration] entities: ${dupes.n} duplicate categories block the new key — leaving keys alone`);
      return { partial: true, created: created.affectedRows, placed, duplicates: Number(dupes.n) };
    }
    if (categoryIndexes.includes('uniq_categories_user_name_year')) {
      await pool.query(`ALTER TABLE categories DROP INDEX uniq_categories_user_name_year`);
    }
    await pool.query(
      `ALTER TABLE categories ADD UNIQUE KEY uniq_categories_user_entity_name_year (user_id, entity_id, name, financial_year)`
    );
  }

  // tax_years was one row per year. A business lodging quarterly needs four,
  // and two businesses need their own.
  const taxYearIndexes = await indexNames(pool, 'tax_years');
  if (!taxYearIndexes.includes('uniq_tax_year_entity_period')) {
    const [[dupes]] = await pool.query(
      `SELECT COUNT(*) AS n FROM (
         SELECT user_id, entity_id, financial_year, period
         FROM tax_years GROUP BY user_id, entity_id, financial_year, period HAVING COUNT(*) > 1
       ) d`
    );
    if (Number(dupes.n) > 0) {
      console.error(`[migration] entities: ${dupes.n} duplicate tax years block the new key — leaving keys alone`);
      return { partial: true, created: created.affectedRows, placed, duplicates: Number(dupes.n) };
    }
    if (taxYearIndexes.includes('uniq_tax_year')) {
      await pool.query(`ALTER TABLE tax_years DROP INDEX uniq_tax_year`);
    }
    await pool.query(
      `ALTER TABLE tax_years ADD UNIQUE KEY uniq_tax_year_entity_period (user_id, entity_id, financial_year, period)`
    );
  }

  // --- Foreign keys, as hardening rather than as enforcement -------------
  //
  // The application refuses to delete an entity that still holds anything, with
  // a readable message. These are the backstop for a bug in that check. If one
  // never lands — an older MariaDB, an unexpected column type — nothing breaks,
  // so a failure is logged rather than thrown.
  for (const [table, name] of [
    ['expenses', 'fk_expenses_entity'],
    ['categories', 'fk_categories_entity'],
    ['vehicle_trips', 'fk_vehicle_trips_entity'],
    ['home_office_hours', 'fk_home_office_entity'],
    ['tax_years', 'fk_tax_years_entity'],
  ]) {
    try {
      if (!(await hasConstraint(pool, name))) {
        await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (entity_id) REFERENCES entities(id)`);
      }
    } catch (err) {
      console.error(`[migration] entities: could not add ${name} — ${err.message}`);
    }
  }

  await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('entities_backfilled', '1')`);

  console.log(
    `[migration] entities: created ${created.affectedRows} default entities and placed ` +
      BACKFILL_TABLES.map((t) => `${placed[t]} ${t}`).join(', ')
  );

  return { created: created.affectedRows, placed };
}
