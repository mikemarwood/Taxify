import mysql from 'mysql2/promise';
import { INITIAL_DEFAULT_CATEGORIES } from './seed/defaultCategories.js';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Adds is_admin to a users table that already existed before this column
  // was introduced. MariaDB supports IF NOT EXISTS on ADD COLUMN.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin TINYINT(1) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path VARCHAR(500) NULL
  `);
  // When this account last made an authenticated request. login_events answers
  // "who signed in", which is not the same question as "who is here now" — a
  // session lasts weeks, so somebody using Taxify daily may not have signed in
  // since March. Written by requireAuth, at most once a minute per account.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at)
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_enabled TINYINT(1) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_prompted TINYINT(1) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(64) NULL
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at DATETIME NULL
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts INT NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_locked_until DATETIME NULL
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_last_prompted_at DATETIME NULL
  `);

  // Billing/subscription support: activation, trial, plan, and Stripe state.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'owner'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_holder_id INT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_token_hash VARCHAR(64) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_token_expires_at DATETIME NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at DATETIME NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at DATETIME NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) NOT NULL DEFAULT 'trialing'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_current_period_end DATETIME NULL`);

  // Sign-up form extras: country/business name are user-editable later,
  // referral_source and terms_accepted_at are one-time capture at signup.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(80) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name VARCHAR(255) NULL`);

  // The firm somebody does other people's returns under, which is a different
  // fact from business_name — that is the business whose expenses they track.
  // One login can legitimately have both: an accountant who also keeps their
  // own books. Two nullable columns rather than a table, because two nullable
  // facts joined to the same row is a table's worth of ceremony for no gain.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS practice_name VARCHAR(160) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_source VARCHAR(100) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at DATETIME NULL`);

  // The number a customer is shown. Nothing joins on it — users.id remains the
  // key — so this exists purely so nobody is told they are customer number 3.
  // Nullable, because it is filled in by a migration rather than by the ALTER,
  // and unique, because the generator relies on the key to settle collisions.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_number CHAR(8) NULL`);
  const [accountNumberIndex] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uniq_users_account_number'`
  );
  if (accountNumberIndex.length === 0) {
    await pool.query(`ALTER TABLE users ADD UNIQUE INDEX uniq_users_account_number (account_number)`);
  }

  // `name` stays as the display name used everywhere else in the app; these
  // are the parts it's assembled from, so a user can correct one without
  // re-typing both.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(80) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS promo_code VARCHAR(40) NULL`);
  // Reminders are sent on a schedule before an unactivated account is purged,
  // so the job needs to know which ones have already gone out.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_reminded_at DATETIME NULL`);

  // Password resets. Only the hash is stored, same as activation tokens — a
  // stolen database backup then can't be used to reset anybody's password.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at DATETIME NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_requested_at DATETIME NULL`);

  // A financial year is not the same twelve months everywhere, so the rule is
  // a property of the account. Existing rows are backfilled to 1 July whatever
  // country they gave: that is what their data was actually filed under, and
  // re-filing someone's history because we learned their country's real rule
  // would move receipts and rewrite closed years.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fy_start_month TINYINT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fy_start_day TINYINT NULL`);
  await pool.query(
    `UPDATE users SET fy_start_month = 7, fy_start_day = 1 WHERE fy_start_month IS NULL OR fy_start_day IS NULL`
  );

  // A requested email change is held here rather than written to `email`, so
  // the account keeps signing in on the address it has until the new one is
  // proven. An abandoned request expires and costs nothing.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email VARCHAR(255) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_token_hash VARCHAR(64) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_expires_at DATETIME NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_requested_at DATETIME NULL`);

  // When the last login code went out, so a resend can be throttled without
  // inferring the send time from the code's expiry.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_last_sent_at DATETIME NULL`);

  // An accountant works for several people, so which books they are looking at
  // is a property of the session, not of their user row. account_holder_id
  // could only ever name one client — this table names all of them, along with
  // how much of each client's history they were given and when their window
  // closes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accountant_assignments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      accountant_user_id INT NOT NULL,
      owner_user_id INT NOT NULL,
      financial_years VARCHAR(255) NULL,
      first_login_at DATETIME NULL,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_accountant_owner (accountant_user_id, owner_user_id),
      KEY idx_assignment_accountant (accountant_user_id),
      FOREIGN KEY (accountant_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // NULL financial_years means the whole history — the column only exists to
  // narrow it.
  await pool.query(`ALTER TABLE accountant_assignments ADD COLUMN IF NOT EXISTS financial_years VARCHAR(255) NULL`);
  // Which sets of books, by id, comma separated. NULL means all of them —
  // the same convention financial_years uses, and the same reason: an
  // assignment made before this existed granted everything, and must keep
  // granting everything rather than silently narrowing to nothing.
  await pool.query(`ALTER TABLE accountant_assignments ADD COLUMN IF NOT EXISTS entity_ids VARCHAR(255) NULL`);

  // How long the window lasts once opened, chosen by the client when they grant
  // access: 24, 48, 72 or 96 hours. A default rather than a constant now — an
  // afternoon job and a full set of books are not the same amount of work.
  await pool.query(
    `ALTER TABLE accountant_assignments ADD COLUMN IF NOT EXISTS window_hours SMALLINT NOT NULL DEFAULT 24`
  );

  // An invitation, which grants nothing at all.
  //
  // Inviting an accountant used to create a login on the spot: a users row with
  // a random password nobody knew, waiting to be activated. Three things went
  // wrong with that. The unactivated-account sweep deleted it after five days
  // and took the client's grant with it, silently. A second client inviting the
  // same person matched that row and was told to sign in with a password that
  // had never existed. And the owner's list could not tell "invited" apart from
  // "accepted, hasn't looked yet".
  //
  // Separating the promise from the login fixes all three by construction: an
  // invitation is its own row, nothing that decides access consults it, and the
  // real login is created only when somebody accepts.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accountant_invites (
      id INT PRIMARY KEY AUTO_INCREMENT,
      owner_user_id INT NOT NULL,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255) NULL,
      financial_years VARCHAR(255) NULL,
      window_hours SMALLINT NOT NULL DEFAULT 24,
      token_hash VARCHAR(64) NULL,
      expires_at DATETIME NOT NULL,
      last_sent_at DATETIME NULL,
      accepted_at DATETIME NULL,
      accepted_user_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_invite_owner_email (owner_user_id, email),
      KEY idx_invite_token (token_hash),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (accepted_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Repeated explicitly, for the same reason as everywhere else in this file:
  // CREATE TABLE IF NOT EXISTS does not reach an install made a release ago.
  for (const column of [
    `name VARCHAR(255) NULL`,
    `financial_years VARCHAR(255) NULL`,
    `entity_ids VARCHAR(255) NULL`,
    `window_hours SMALLINT NOT NULL DEFAULT 24`,
    `token_hash VARCHAR(64) NULL`,
    `last_sent_at DATETIME NULL`,
    `accepted_at DATETIME NULL`,
    `accepted_user_id INT NULL`,
    // Kept alongside `name` rather than replacing it. `name` is what the
    // invitation email, the sign-up page and every existing row already read,
    // so it stays as the composed display name; these are what was actually
    // typed, and what fills the accountant's own profile when they accept.
    `first_name VARCHAR(120) NULL`,
    `last_name VARCHAR(120) NULL`,
    `company_name VARCHAR(160) NULL`,
  ]) {
    await pool.query(`ALTER TABLE accountant_invites ADD COLUMN IF NOT EXISTS ${column}`);
  }

  // Accountants who predate the table keep the client they already had.
  await pool.query(`
    INSERT IGNORE INTO accountant_assignments (accountant_user_id, owner_user_id)
    SELECT id, account_holder_id FROM users
    WHERE role = 'accountant' AND account_holder_id IS NOT NULL
  `);

  // Once the assignment above exists, account_holder_id on an accountant is
  // not just redundant — it is dangerous. "Whose books does this login share"
  // is answered by that column, so an accountant carrying it would have their
  // own expenses read as part of their client's the moment they started
  // keeping any. Runs every boot: it is a WHERE-guarded no-op after the first.
  await pool.query(`UPDATE users SET account_holder_id = NULL WHERE role = 'accountant'`);

  // Admin-granted access that ignores the subscription state entirely. NULL
  // `until` means open-ended; a date makes it lapse on its own.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_bypass TINYINT(1) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_bypass_until DATETIME NULL`);

  // Split an existing single-field name so older accounts have parts too. Only
  // touches rows where the split hasn't happened, so it's safe on every boot.
  await pool.query(`
    UPDATE users
       SET first_name = TRIM(SUBSTRING_INDEX(name, ' ', 1)),
           last_name = NULLIF(TRIM(SUBSTRING(name, LOCATE(' ', name))), '')
     WHERE first_name IS NULL AND name IS NOT NULL AND name <> ''
  `);

  // Promo codes are set up in the admin panel and applied at sign-up. A code
  // can be limited to one plan, capped by uses, and given an expiry.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      description VARCHAR(255) NULL,
      plan_type VARCHAR(20) NULL,
      percent_off DECIMAL(5,2) NULL,
      amount_off DECIMAL(10,2) NULL,
      trial_days INT NULL,
      max_uses INT NULL,
      used_count INT NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_promo_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // A set of books. An account has one Individual and any number of small
  // businesses, and an expense belongs to exactly one of them — which is what
  // makes "what percentage of this was business use?" a question worth asking
  // of some expenses and nobody's business on the rest.
  //
  // user_id is the ACCOUNT HOLDER, not the login. On a Family plan both people
  // must see one set of books, so every join from expenses or categories —
  // whose user_id is the login — goes through COALESCE(account_holder_id, id).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entities (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'individual',
      lodgement_cadence VARCHAR(12) NOT NULL DEFAULT 'annual',
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      path_segment VARCHAR(80) NULL,
      color VARCHAR(20) NULL,
      archived_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL,
      UNIQUE KEY uniq_entities_user_name (user_id, name),
      UNIQUE KEY uniq_entities_user_segment (user_id, path_segment),
      KEY idx_entities_user_default (user_id, is_default),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Repeated explicitly, because CREATE TABLE IF NOT EXISTS does not reach an
  // install that made this table one release ago. That has already caused two
  // bugs in this codebase; it is not going to cause a third.
  for (const column of [
    `name VARCHAR(120) NOT NULL`,
    `kind VARCHAR(20) NOT NULL DEFAULT 'individual'`,
    `lodgement_cadence VARCHAR(12) NOT NULL DEFAULT 'annual'`,
    `is_default TINYINT(1) NOT NULL DEFAULT 0`,
    // NULL for the default entity, and that is the whole receipt-path
    // guarantee: there is nothing to append, so its folders are byte-for-byte
    // what they were before entities existed and not one file has to move.
    // Generated once and never changed, so renaming an entity cannot move a
    // file either — which is exactly the bug category renames still have.
    `path_segment VARCHAR(80) NULL`,
    `color VARCHAR(20) NULL`,
    `archived_at DATETIME NULL`,
    `updated_at DATETIME NULL`,
  ]) {
    await pool.query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS ${column}`);
  }

  // Every account should have exactly one default set of books — the one that
  // opens on sign-in. is_default was never set on create, so an account only
  // had one if somebody pressed "Make default", and most never did.
  //
  // The oldest gets it: for almost every account that is the individual return
  // created at sign-up, and it is the only choice that does not depend on a
  // name or a kind that may since have changed. Accounts that already have a
  // default are left exactly as they are.
  await pool.query(`
    UPDATE entities e
      JOIN (
        SELECT user_id, MIN(id) AS first_id
          FROM entities
         WHERE archived_at IS NULL
         GROUP BY user_id
        HAVING SUM(is_default) = 0
      ) missing ON missing.first_id = e.id
       SET e.is_default = 1
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      entity_id INT NULL,
      name VARCHAR(255) NOT NULL,
      color VARCHAR(20) NOT NULL,
      icon VARCHAR(50) NOT NULL DEFAULT 'tag',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_categories_user_name (user_id, name),
      KEY idx_categories_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // CREATE TABLE IF NOT EXISTS leaves an existing table alone, so a database
  // created before `icon` was part of the definition never got the column and
  // every category drew the fallback. Adding it explicitly is the only thing
  // that reaches those installs.
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon VARCHAR(50) NOT NULL DEFAULT 'tag'`);

  // Categories belong to a financial year: what you claimed against in
  // 2024-2025 is not necessarily how you'd file this year, and a renamed or
  // retired category must not rewrite what a closed year said. NULL means a
  // row that predates the split and has not been placed yet.
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS financial_year VARCHAR(9) NULL`);

  // The unique key on categories has been rebuilt twice: (user_id, name) first
  // gained the financial year, then the set of books, so two businesses can each
  // have a "Tooling" in the same year.
  //
  // The entity-aware key is added by migrations/entities.js, which runs *after*
  // this function on every boot — so the check below must not re-add the
  // year-only key once the entity one exists. It used to, unconditionally, which
  // meant that from the second boot after that migration both keys were present
  // and the older one quietly re-imposed one category name per user per year
  // across every set of books. Creating the second business's "Tooling" then
  // failed with a duplicate-key error nobody could explain.
  const [categoryIndexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories'
       AND INDEX_NAME IN ('uniq_categories_user_name', 'uniq_categories_user_name_year',
                          'uniq_categories_user_entity_name_year')`
  );
  const indexNames = categoryIndexes.map((r) => r.INDEX_NAME);
  if (indexNames.includes('uniq_categories_user_name')) {
    await pool.query(`ALTER TABLE categories DROP INDEX uniq_categories_user_name`);
  }
  // Already superseded — leave it alone, and remove it if a previous boot put it
  // back alongside the key that replaced it.
  if (indexNames.includes('uniq_categories_user_entity_name_year')) {
    if (indexNames.includes('uniq_categories_user_name_year')) {
      await pool.query(`ALTER TABLE categories DROP INDEX uniq_categories_user_name_year`);
      console.log('[schema] removed the superseded category key that was blocking two businesses sharing a name');
    }
  } else if (!indexNames.includes('uniq_categories_user_name_year')) {
    await pool.query(
      `ALTER TABLE categories ADD UNIQUE KEY uniq_categories_user_name_year (user_id, name, financial_year)`
    );
  }

  // A property rental has paperwork that belongs to the property itself rather
  // than to any one expense — agent statements, depreciation schedules, the
  // end-of-year summary — so those categories get a document store.
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_property_rental TINYINT(1) NOT NULL DEFAULT 0`);

  // The admin side of a financial year, as opposed to what was spent in it:
  // when the return is being done and with whom, what came back, and whether
  // the year is closed. All three are the same year's story, so they live on
  // one row. The refund is often the accountant's to know first, which is why
  // it is the one thing an accountant may write — recorded_by keeps that
  // honest.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_years (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      financial_year VARCHAR(9) NOT NULL,
      amount DECIMAL(12, 2) NULL,
      notes VARCHAR(500) NULL,
      recorded_by INT NULL,
      recorded_at DATETIME NULL,
      updated_at DATETIME NULL,
      finalised_at DATETIME NULL,
      finalised_by INT NULL,
      appointment_at DATETIME NULL,
      appointment_company VARCHAR(160) NULL,
      appointment_accountant VARCHAR(160) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_tax_year (user_id, financial_year),
      KEY idx_tax_years_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  for (const column of [
    'amount DECIMAL(12, 2) NULL',
    'notes VARCHAR(500) NULL',
    'recorded_by INT NULL',
    'recorded_at DATETIME NULL',
    'updated_at DATETIME NULL',
    'finalised_at DATETIME NULL',
    'finalised_by INT NULL',
    'appointment_at DATETIME NULL',
    'appointment_company VARCHAR(160) NULL',
    'appointment_accountant VARCHAR(160) NULL',
    // Both reminders are once-only, and remembering that they went is the
    // whole difference between a useful nudge and being nagged.
    'booking_reminder_sent_at DATETIME NULL',
    'appointment_reminder_sent_at DATETIME NULL',
  ]) {
    await pool.query(`ALTER TABLE tax_years ADD COLUMN IF NOT EXISTS ${column}`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS category_documents (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      category_id INT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      document_name VARCHAR(255) NULL,
      financial_year VARCHAR(9) NULL,
      size_bytes INT NULL,
      uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_category_document (category_id, financial_year, filename),
      KEY idx_category_documents_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // CREATE TABLE IF NOT EXISTS leaves an existing table alone, so an install
  // that already created category_documents never picks up later columns from
  // the definition above — they have to be added explicitly.
  await pool.query(`ALTER TABLE category_documents ADD COLUMN IF NOT EXISTS document_name VARCHAR(255) NULL`);

  // The unique key originally covered (category_id, filename), which was right
  // when documents sat directly under the category. Now they're filed per
  // financial year, the same statement name can legitimately appear in two
  // years, so the year has to be part of the key.
  //
  // Keyed off the schema rather than a settings flag: this runs before the
  // settings table exists, and the index itself is the honest record of
  // whether the change has been applied.
  const [indexCols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'category_documents'
       AND INDEX_NAME = 'uniq_category_document'`
  );
  if (indexCols.length > 0 && !indexCols.some((c) => c.COLUMN_NAME === 'financial_year')) {
    try {
      // Built before the old one is dropped, and that order is the whole fix.
      // category_id has a foreign key, InnoDB requires an index to enforce it,
      // and uniq_category_document was the only one covering that column — so
      // dropping it first failed with "needed in a foreign key constraint",
      // every single boot, for months. The replacement leads with category_id,
      // so once it exists the foreign key has what it needs and the old index
      // is free to go.
      const [replacement] = await pool.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'category_documents'
           AND INDEX_NAME = 'uniq_category_document_year' LIMIT 1`
      );
      if (replacement.length === 0) {
        await pool.query(
          `ALTER TABLE category_documents ADD UNIQUE KEY uniq_category_document_year (category_id, financial_year, filename)`
        );
      }
      await pool.query(`ALTER TABLE category_documents DROP INDEX uniq_category_document`);
      console.log('[schema] rebuilt category document index to include the financial year');
    } catch (err) {
      console.error('Could not rebuild the category document index', err.message);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      category_id INT NULL,
      item_name VARCHAR(500) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'AUD',
      purchase_date DATE NOT NULL,
      receipt_path VARCHAR(500) NULL,
      is_recurring TINYINT(1) NOT NULL DEFAULT 0,
      frequency VARCHAR(50) NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_expenses_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Soft delete. A non-null deleted_at takes the expense out of the app
  // immediately; purgeExpiredTrash removes the row for good 30 days later.
  // There is no bin to browse — the window exists so that deleting the wrong
  // thing is a database query rather than an apology.
  await pool.query(`
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL
  `);
  // Recurring-expense automation: next_due_date drives when the background
  // job spawns the next occurrence; auto_generated/notified_at track rows
  // the job created and whether the user has been toasted about them yet.
  await pool.query(`
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS next_due_date DATE NULL
  `);
  await pool.query(`
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS auto_generated TINYINT(1) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notified_at DATETIME NULL
  `);
  // Idempotency key for one-off spreadsheet imports (see scripts/importLegacy.js).
  // NULL for everything created through the app, and MariaDB allows repeated
  // NULLs in a unique index, so only imported rows are constrained.
  await pool.query(`
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS import_key VARCHAR(190) NULL
  `);
  await pool.query(`
    ALTER TABLE expenses ADD UNIQUE INDEX IF NOT EXISTS uq_expenses_import (user_id, import_key)
  `);

  // Who entered it and who touched it last. user_id is who the expense belongs
  // to, which on a Family plan isn't the same question — either person can add
  // and edit, and "who put this in?" is the one that gets asked.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by INT NULL`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_by INT NULL`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL`);

  // Every total in the app used to sum `amount` and ignore `currency`, so a
  // EUR 500 expense added 500 to an AUD figure. The converted amount lives
  // here and is what everything sums; `amount` and `currency` stay exactly as
  // entered, because the receipt says what the receipt says.
  //
  // base_amount is deliberately NULLable: a row we cannot honestly convert is
  // excluded from totals and reported, rather than counted at face value.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS base_currency VARCHAR(3) NULL`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS base_amount DECIMAL(12, 2) NULL`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate DECIMAL(18, 8) NULL`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate_source VARCHAR(20) NULL`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate_date DATE NULL`);

  // Partial business use. A laptop used 60% for work is a $2,000 receipt and a
  // $1,200 claim; both are true, and an auditor needs to see both. Without this
  // the only way to record it was to type 60% of the price, which destroyed the
  // real amount and the audit trail with it.
  await pool.query(
    `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS business_use_pct DECIMAL(5, 2) NOT NULL DEFAULT 100.00`
  );

  // `expenses` carried a single index on user_id, so every list query filtered
  // on it and then sorted the result by hand, and the per-category totals
  // scanned the table once per category. Column order matters below:
  // deleted_at second is effectively an equality on NULL, which leaves
  // purchase_date usable for the ORDER BY and removes the filesort.
  await pool.query(
    `ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_user_deleted_date (user_id, deleted_at, purchase_date)`
  );
  // Trailing base_amount makes the COUNT and SUM subqueries in the categories
  // route index-only — they never touch the row itself.
  await pool.query(
    `ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_category_deleted (category_id, deleted_at, base_amount)`
  );
  // The hourly trash purge and the hourly recurring-expense job both used to
  // full-scan.
  await pool.query(`ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_deleted_at (deleted_at)`);
  await pool.query(
    `ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_recurring_due (is_recurring, next_due_date)`
  );

  // Deduction rates that change every year — cents per kilometre, the
  // kilometre cap, the home-office hourly rate. Held as data and edited in the
  // admin panel rather than written into the code, because a hard-coded rate
  // goes stale silently and then quietly under- or over-claims for everyone.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_rates (
      id INT PRIMARY KEY AUTO_INCREMENT,
      financial_year VARCHAR(9) NOT NULL,
      \`key\` VARCHAR(40) NOT NULL,
      value DECIMAL(10, 3) NOT NULL,
      updated_at DATETIME NULL,
      UNIQUE KEY uniq_tax_rate (financial_year, \`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // A car log. The kilometre cap is per vehicle per year, which is why the
  // vehicle is a column and not a note in the purpose — a two-car household
  // claiming the cap on each is legitimate and must not be silently merged.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicle_trips (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      financial_year VARCHAR(9) NOT NULL,
      trip_date DATE NOT NULL,
      vehicle VARCHAR(80) NOT NULL,
      km DECIMAL(8, 1) NOT NULL,
      purpose VARCHAR(255) NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vehicle_trips_user_year (user_id, financial_year),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Hours worked from home. The fixed-rate method requires a contemporaneous
  // record, so the value of this is precisely that it is a dated log rather
  // than one number remembered at year end.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS home_office_hours (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      financial_year VARCHAR(9) NOT NULL,
      entry_date DATE NOT NULL,
      hours DECIMAL(5, 2) NOT NULL,
      note VARCHAR(255) NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_home_office_user_year (user_id, financial_year),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Which set of books each row belongs to.
  //
  // Deliberately NULL-able, and it stays that way. ADD COLUMN ... NOT NULL on a
  // populated table fills 0, which is not a valid foreign key target, so the FK
  // could then never be created; tightening it afterwards is a full rebuild of
  // the largest table. More usefully, NULL is a tripwire — migrations/entities
  // counts what is left and refuses to swap the unique keys while any remain.
  // A partial backfill and a finished one have to look different.
  for (const table of ['expenses', 'categories', 'vehicle_trips', 'home_office_hours', 'tax_years']) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS entity_id INT NULL`);
  }

  // Which lodgement within the year. 'FY' for an entity that lodges annually,
  // 'Q1'..'Q4' for one that lodges quarterly.
  //
  // The DEFAULT is what preserves every existing row for free: each becomes the
  // annual lodgement of the account's default entity, which is precisely what
  // it already was. Nothing moves, so the finalisation lock, the appointment
  // and both reminder markers keep working untouched.
  await pool.query(`ALTER TABLE tax_years ADD COLUMN IF NOT EXISTS period VARCHAR(8) NOT NULL DEFAULT 'FY'`);

  await pool.query(
    `ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_user_entity_deleted_date (user_id, entity_id, deleted_at, purchase_date)`
  );
  await pool.query(
    `ALTER TABLE vehicle_trips ADD INDEX IF NOT EXISTS idx_vehicle_trips_entity_year (user_id, entity_id, financial_year)`
  );
  await pool.query(
    `ALTER TABLE home_office_hours ADD INDEX IF NOT EXISTS idx_home_office_entity_year (user_id, entity_id, financial_year)`
  );

  // Rates, kept permanently. Partly so the same day is never fetched twice,
  // and partly because it is the record of which rate a figure was actually
  // built from — an accountant asking "where did this number come from" is
  // entitled to an answer.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fx_rates (
      rate_date DATE NOT NULL,
      base VARCHAR(3) NOT NULL,
      quote VARCHAR(3) NOT NULL,
      rate DECIMAL(18, 8) NOT NULL,
      fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (rate_date, base, quote)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Existing rows predate the column; the owner is the best guess available.
  await pool.query(`UPDATE expenses SET created_by = user_id WHERE created_by IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS default_categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      color VARCHAR(20) NOT NULL,
      icon VARCHAR(50) NOT NULL DEFAULT 'tag',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_default_categories_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`ALTER TABLE default_categories ADD COLUMN IF NOT EXISTS icon VARCHAR(50) NOT NULL DEFAULT 'tag'`);

  const [existing] = await pool.query('SELECT COUNT(*) AS count FROM default_categories');
  if (existing[0].count === 0) {
    for (const c of INITIAL_DEFAULT_CATEGORIES) {
      await pool.execute('INSERT INTO default_categories (name, color, icon) VALUES (?, ?, ?)', [c.name, c.color, c.icon]);
    }
  }

  // Things worth telling someone about, kept rather than shouted once. A toast
  // that vanishes in three seconds is not a notification — if the app has
  // something to say, it should still be there when you come back.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      title VARCHAR(160) NOT NULL,
      body VARCHAR(500) NULL,
      url VARCHAR(255) NULL,
      kind VARCHAR(40) NULL,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_notifications_user (user_id, read_at, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Where to push them. One row per install — the same person may have the app
  // on a phone and a tablet, and a token changes whenever Android decides it
  // should, so the token itself is the key rather than the user.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      token VARCHAR(255) PRIMARY KEY,
      user_id INT NOT NULL,
      platform VARCHAR(20) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NULL,
      KEY idx_device_tokens_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Who signed in, when, and from what. Kept because "was that really them?"
  // is the first question asked when an account looks wrong, and because a
  // support conversation goes very differently once you can see they have only
  // ever used the Android app.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_events (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      device VARCHAR(20) NULL,
      platform VARCHAR(40) NULL,
      browser VARCHAR(40) NULL,
      ip VARCHAR(45) NULL,
      method VARCHAR(20) NULL,
      KEY idx_login_events_user (user_id, at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Somebody asking to move between plans, and what happened next.
  //
  // A row exists because the change is not self-serve: an administrator quotes
  // it, sends an invoice, and the plan moves when that invoice is paid. Kept
  // rather than acted on immediately so there is a record of who asked for
  // what, what they were charged, and when it took effect — which is the first
  // thing wanted when somebody says they paid for something they do not have.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plan_change_requests (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      from_plan VARCHAR(20) NULL,
      to_plan VARCHAR(20) NOT NULL,
      -- pending -> invoiced -> paid, or cancelled from either of the first two.
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      note VARCHAR(500) NULL,
      stripe_invoice_id VARCHAR(255) NULL,
      invoice_url VARCHAR(500) NULL,
      invoice_amount_cents INT NULL,
      invoice_currency VARCHAR(10) NULL,
      invoiced_at DATETIME NULL,
      invoiced_by INT NULL,
      paid_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL,
      KEY idx_plan_requests_user (user_id, status),
      KEY idx_plan_requests_status (status, created_at),
      -- The webhook finds the request by the invoice it was paid against.
      KEY idx_plan_requests_invoice (stripe_invoice_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invoiced_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Support conversations.
  //
  // A ticket can belong to an account or to nobody — somebody who cannot sign
  // in is exactly who most needs to reach support — so user_id is nullable and
  // a guest carries their own name and address instead. A guest reads the
  // thread through a link they are emailed, which is what access_token_hash is
  // for: the token itself is never stored, the same as every other token here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INT PRIMARY KEY AUTO_INCREMENT,
      -- The number people quote. Never the row id.
      reference VARCHAR(24) NOT NULL,
      user_id INT NULL,
      guest_name VARCHAR(120) NULL,
      guest_email VARCHAR(255) NULL,
      category VARCHAR(40) NOT NULL,
      subject VARCHAR(160) NOT NULL,
      -- awaiting_support | awaiting_customer | closed. Whose turn it is, rather
      -- than a vaguer open/closed: "who is this waiting on" is the only thing
      -- either side actually wants to know.
      status VARCHAR(24) NOT NULL DEFAULT 'awaiting_support',
      access_token_hash VARCHAR(64) NULL,
      last_message_at DATETIME NULL,
      closed_at DATETIME NULL,
      closed_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL,
      UNIQUE KEY uniq_support_reference (reference),
      KEY idx_support_user (user_id, status),
      KEY idx_support_status (status, last_message_at),
      KEY idx_support_token (access_token_hash),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      ticket_id INT NOT NULL,
      -- Null for a guest, and for anything the system wrote.
      author_user_id INT NULL,
      -- customer | support | system. Held on the message rather than derived
      -- from the author, because an administrator is also somebody's customer,
      -- and which of the two they were *in this conversation* is what the badge
      -- has to show.
      author_role VARCHAR(16) NOT NULL,
      author_name VARCHAR(160) NULL,
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_support_messages_ticket (ticket_id, created_at),
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // This column was VARCHAR(255), which fits every setting written when it was
  // introduced and none of the ones written since. A Firebase service-account
  // key is about 2.3 KB, so saving one failed on the insert and the admin page
  // showed "Something went wrong" — the route's own validation had already
  // passed, so nothing pointed at the length.
  //
  // Guarded by the current type rather than run unconditionally: MODIFY
  // rebuilds the table, and doing that on every boot for a no-op is a cost
  // paid forever.
  const [valueColumn] = await pool.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'settings' AND column_name = 'value'`
  );
  if (valueColumn[0] && String(valueColumn[0].data_type).toLowerCase() !== 'text') {
    await pool.query(`ALTER TABLE settings MODIFY COLUMN value TEXT NOT NULL`);
  }

  // Installs that predate the icon column ended up with every seeded category
  // showing the generic fallback. Give the defaults their intended icons back,
  // once, and only where nothing has been chosen — a category someone
  // deliberately re-iconed is left alone.
  const [backfilled] = await pool.query(`SELECT value FROM settings WHERE \`key\` = 'category_icons_backfilled'`);
  if (backfilled.length === 0) {
    for (const c of INITIAL_DEFAULT_CATEGORIES) {
      if (c.icon === 'tag') continue;
      await pool.execute(`UPDATE default_categories SET icon = ? WHERE name = ? AND (icon = 'tag' OR icon = '')`, [
        c.icon,
        c.name,
      ]);
      await pool.execute(`UPDATE categories SET icon = ? WHERE name = ? AND (icon = 'tag' OR icon = '')`, [
        c.icon,
        c.name,
      ]);
    }
    await pool.execute(`INSERT INTO settings (\`key\`, value) VALUES ('category_icons_backfilled', '1')`);
  }
  await pool.query(`
    INSERT IGNORE INTO settings (\`key\`, value) VALUES ('registration_enabled', 'true')
  `);
  await pool.query(`
    INSERT IGNORE INTO settings (\`key\`, value) VALUES ('mfa_mode', 'optional')
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sent_reminders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      reminder_key VARCHAR(40) NOT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_reminder (user_id, reminder_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // One-time backfill: accounts created before the billing system existed are
  // grandfathered onto a fresh trial rather than being treated as unactivated.
  const backfillDone = await getSetting('billing_backfill_done');
  if (backfillDone !== 'true') {
    await pool.query(`
      UPDATE users
      SET activated_at = NOW(), trial_ends_at = DATE_ADD(NOW(), INTERVAL 14 DAY), subscription_status = 'trialing'
      WHERE activated_at IS NULL
    `);
    await setSetting('billing_backfill_done', 'true');
  }
}

export async function getSetting(key) {
  const [rows] = await pool.execute('SELECT value FROM settings WHERE `key` = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await pool.execute('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [key, value, value]);
}

export async function getMfaMode() {
  const mode = await getSetting('mfa_mode');
  return mode === 'required' ? 'required' : 'optional';
}

export default pool;
