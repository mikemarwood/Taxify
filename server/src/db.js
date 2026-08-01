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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_source VARCHAR(100) NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at DATETIME NULL`);

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

  // Accountants who predate the table keep the client they already had.
  await pool.query(`
    INSERT IGNORE INTO accountant_assignments (accountant_user_id, owner_user_id)
    SELECT id, account_holder_id FROM users
    WHERE role = 'accountant' AND account_holder_id IS NOT NULL
  `);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
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

  // The old unique key was (user_id, name), which now has to admit the same
  // name once per year. Rebuilt from information_schema because ALTER ... DROP
  // KEY has no IF EXISTS in older MariaDB.
  const [categoryIndexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories'
       AND INDEX_NAME IN ('uniq_categories_user_name', 'uniq_categories_user_name_year')`
  );
  const indexNames = categoryIndexes.map((r) => r.INDEX_NAME);
  if (indexNames.includes('uniq_categories_user_name')) {
    await pool.query(`ALTER TABLE categories DROP INDEX uniq_categories_user_name`);
  }
  if (!indexNames.includes('uniq_categories_user_name_year')) {
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
      await pool.query(`ALTER TABLE category_documents DROP INDEX uniq_category_document`);
      await pool.query(
        `ALTER TABLE category_documents ADD UNIQUE KEY uniq_category_document (category_id, financial_year, filename)`
      );
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
  // Soft-delete support: a non-null deleted_at moves an expense into the
  // recycle bin instead of removing it immediately.
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(64) PRIMARY KEY,
      value VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

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
