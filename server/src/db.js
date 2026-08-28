import mysql from 'mysql2/promise';
import { INITIAL_DEFAULT_CATEGORIES } from './seed/defaultCategories.js';
import { backfillEntryNumbers, FIRST_ENTRY_NUMBER } from './lib/entryNumber.js';

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
  // Support staff. Deliberately separate from is_admin rather than a level of
  // it: this grants the support queue and nothing else — no users, no billing,
  // no Stripe keys, no view-as. Somebody answering tickets does not need the
  // ability to change anybody's plan, and giving it to them anyway is how a
  // support account becomes the most valuable thing to steal.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_support TINYINT(1) NOT NULL DEFAULT 0
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

  // An invitation now has three endings, not one.
  //
  // It used to be accepted or nothing — a link that went unopened simply sat
  // there until it expired, and the person who sent it was never told either
  // way. Declining is now a thing an accountant can do, and running out of time
  // is something the client hears about, so both need somewhere to be recorded.
  //
  // declined_at is the accountant saying no. expired_notified_at is our own
  // bookkeeping: the moment we told the client nobody answered, so the nightly
  // sweep cannot tell them twice.
  // Acting for other people, as a thing you choose rather than a thing that
  // happens to you. isAccountant used to mean "has at least one live
  // assignment", so you became one by being invited and stopped being one
  // when the last access lapsed — leaving an ordinary account holder who
  // also does the books for a relative with nothing to turn on.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS acts_for_clients TINYINT(1) NOT NULL DEFAULT 0`);

  // The readings a distance was worked out from.
  //
  // Only the distance was ever kept — "the readings are how somebody arrived at
  // it, not something the claim is made of", which is true of the claim and
  // wrong about the logbook. A logbook that records 338 km and a logbook that
  // records 41,200 to 41,538 are not equally good answers to somebody asking
  // where the number came from, and the second one is the one being asked for.
  //
  // Nullable, because every trip entered before this had no readings to keep
  // and inventing them would be worse than leaving them blank.
  await pool.query(`ALTER TABLE vehicle_trips ADD COLUMN IF NOT EXISTS odo_start INT NULL`);
  await pool.query(`ALTER TABLE vehicle_trips ADD COLUMN IF NOT EXISTS odo_end INT NULL`);

  // Where the journey started and where it finished.
  //
  // Nullable for the same reason as the readings above: every trip logged
  // before this has none, and inventing them would be worse than a blank. A
  // logbook entry is expected to show both ends of a journey, so a trip
  // carrying them is a stronger record than one with only a purpose.
  await pool.query(`ALTER TABLE vehicle_trips ADD COLUMN IF NOT EXISTS start_place VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE vehicle_trips ADD COLUMN IF NOT EXISTS end_place VARCHAR(120) NULL`);

  await pool.query(`ALTER TABLE accountant_invites ADD COLUMN IF NOT EXISTS declined_at DATETIME NULL`);
  await pool.query(
    `ALTER TABLE accountant_invites ADD COLUMN IF NOT EXISTS expired_notified_at DATETIME NULL`
  );

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
  //
  // That is what sent_reminders does, keyed by user and reminder — this column
  // was the first attempt at the same thing and could only remember one
  // reminder per account. Nothing has read or written it since. Dropped rather
  // than left, because a column nobody writes is one somebody eventually
  // trusts.
  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS activation_reminded_at`);

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
  // 'read' or 'write'. Defaults to 'read', which is what every assignment made
  // before this column existed granted — and what anybody who does not think
  // about it should keep getting.
  await pool.query(`ALTER TABLE accountant_assignments ADD COLUMN IF NOT EXISTS access_level VARCHAR(10) NOT NULL DEFAULT 'read'`);

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
      -- The hash of a link that has been used. A lookup key, never a
      -- credential — see the note beside the ALTER further down.
      spent_token_hash VARCHAR(64) NULL,
      expires_at DATETIME NOT NULL,
      last_sent_at DATETIME NULL,
      accepted_at DATETIME NULL,
      accepted_user_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_invite_owner_email (owner_user_id, email),
      KEY idx_invite_token (token_hash),
      KEY idx_invite_spent (spent_token_hash),
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
    // The hash of a link that has been used.
    //
    // Accepting sets token_hash to NULL so the link stops being a credential,
    // which meant the row could no longer be found by the link at all — and
    // somebody clicking their own invitation a second time got a 404, which
    // the page reads as "this is a family invitation" and answers with a
    // password box for an account they already have.
    //
    // This is a lookup key and nothing else. Nothing accepts against it: the
    // row still carries accepted_at, so every path that reads it answers
    // "already accepted".
    `spent_token_hash VARCHAR(64) NULL`,
  ]) {
    await pool.query(`ALTER TABLE accountant_invites ADD COLUMN IF NOT EXISTS ${column}`);
  }
  await pool.query(
    `ALTER TABLE accountant_invites ADD INDEX IF NOT EXISTS idx_invite_spent (spent_token_hash)`
  );

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
  // Categories belong to a set of books, and the key has to agree.
  //
  // entity_id has been on this table for a long time and the list has always
  // filtered by it, so categories looked per-book — but the unique key was
  // (user_id, name, financial_year) with no entity in it, which made "Fuel" on
  // the business and "Fuel" on the personal books the same row as far as the
  // database was concerned. One of the two could exist and the other collided.
  // So they were per-book in the reading and shared in the writing, which is
  // the worst of both.
  //
  // This block already knew about the wider key by name and only ever dropped
  // the narrow one *if the wide one was already there* — which nothing created.
  // It creates it now.
  //
  // Order matters: the wider key is added first, and it cannot fail on
  // duplicates because the narrower key it replaces forbade them.
  if (!indexNames.includes('uniq_categories_user_entity_name_year')) {
    await pool.query(
      `ALTER TABLE categories ADD UNIQUE KEY uniq_categories_user_entity_name_year (user_id, entity_id, name, financial_year)`
    );
    console.log('[schema] categories are keyed per set of books');
  }
  if (indexNames.includes('uniq_categories_user_name_year')) {
    await pool.query(`ALTER TABLE categories DROP INDEX uniq_categories_user_name_year`);
    console.log('[schema] removed the category key that stopped two books sharing a name');
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
  // The idempotency key for one-off spreadsheet imports, removed.
  //
  // It went with the importer: scripts/importLegacy.js and legacySheet.js are
  // gone, the xlsx dependency with them, and the comment that used to sit here
  // pointed at a file that no longer existed. Nothing has read or written this
  // column since. Dropped rather than left, for the same reason
  // activation_reminded_at was: a column nobody writes is one somebody
  // eventually trusts.
  //
  // THE INDEX FIRST, AND THAT ORDER IS NOT COSMETIC.
  //
  // uq_expenses_import is UNIQUE (user_id, import_key). Dropping a column that
  // sits in a multi-column index does not drop the index — MariaDB removes the
  // column from it and keeps what is left, which here would be UNIQUE
  // (user_id): one expense per customer, forever, and every insert after their
  // first refused. Dropping the index first leaves nothing to be reduced.
  await pool.query(`
    ALTER TABLE expenses DROP INDEX IF EXISTS uq_expenses_import
  `);
  await pool.query(`
    ALTER TABLE expenses DROP COLUMN IF EXISTS import_key
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

  // Which kind of books a default belongs to.
  //
  // There were three starter lists and only one of them was editable. This
  // table fed an account's very first set of books; a hard-coded pair in
  // entities.routes.js fed every book created afterwards, one list for a
  // business and one for personal — and an administrator could see none of it.
  // Editing the list here changed nothing about any book made later, which is
  // most of them.
  //
  // 'both' is the honest default for rows that predate the column: they were
  // written when there was no distinction, and guessing one for somebody else's
  // list would be worse than saying it applies to either.
  await pool.query(
    `ALTER TABLE default_categories ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'both'`
  );

  // The name alone can no longer be unique: "General" is wanted on both lists,
  // and with one key across the table only one of the two could exist.
  const [defaultIdx] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'default_categories'`
  );
  const defaultIdxNames = defaultIdx.map((r) => r.INDEX_NAME);
  if (!defaultIdxNames.includes('uniq_default_categories_kind_name')) {
    await pool.query(
      `ALTER TABLE default_categories ADD UNIQUE KEY uniq_default_categories_kind_name (kind, name)`
    );
  }
  if (defaultIdxNames.includes('uniq_default_categories_name')) {
    await pool.query(`ALTER TABLE default_categories DROP INDEX uniq_default_categories_name`);
  }

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
      -- When Stripe expects it paid by. Held so the panel can say "overdue"
      -- rather than leaving somebody to open the invoice to find out.
      invoice_due_at DATETIME NULL,
      paid_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      -- Withdrawn in Stripe rather than here: voided, or written off as
      -- uncollectible. A separate column from cancelled_at because they are
      -- different events with different explanations owed to the customer.
      voided_at DATETIME NULL,
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

  // Repeated for installs that predate them, the same as everywhere else here.
  await pool.query(
    `ALTER TABLE accountant_invites ADD COLUMN IF NOT EXISTS access_level VARCHAR(10) NOT NULL DEFAULT 'read'`
  );

  for (const column of [`invoice_due_at DATETIME NULL`, `voided_at DATETIME NULL`]) {
    await pool.query(`ALTER TABLE plan_change_requests ADD COLUMN IF NOT EXISTS ${column}`);
  }

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
      plan_change_request_id INT NULL,
      UNIQUE KEY uniq_support_reference (reference),
      KEY idx_support_user (user_id, status),
      KEY idx_support_status (status, last_message_at),
      -- Unique, not just indexed. Two tickets sharing a token would mean one
      -- link opening somebody else's conversation, and a plain index would let
      -- that be written without complaint.
      UNIQUE KEY uniq_support_token (access_token_hash),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // For installs whose support tables were created a release before this.
  // The Stripe coupon standing for this promo code, created the first time
  // somebody redeems it and reused after that. Stored so a code does not
  // accumulate a coupon per customer in the Stripe dashboard.
  await pool.query(`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS stripe_coupon_id VARCHAR(255) NULL`);
  // When this account actually spent its promo code. The code is recorded at
  // registration; the discount is not applied until they pay, and only once —
  // without this a code would discount a second subscription after somebody
  // cancelled and came back.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS promo_redeemed_at DATETIME NULL`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS plan_change_request_id INT NULL`);
  // When each side last read the thread. A badge counts a ticket only while it
  // is both waiting on you *and* unread — otherwise the number sits there after
  // you have looked, and a number that will not clear is one people stop
  // looking at.
  // Who is dealing with it. Null means nobody has picked it up yet.
  //
  // Reading is open to all support staff — you cannot pick up work you are not
  // allowed to see, and a queue nobody can read is a queue nobody clears.
  // Replying is not: two people answering the same person separately is worse
  // than a slow answer, and the customer sees both.
  // How urgent, set by support rather than asked of the customer — everybody
  // believes their own problem is urgent, and a field where they say so tells
  // you nothing you did not already know.
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(12) NOT NULL DEFAULT 'normal'`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to INT NULL`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_at DATETIME NULL`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS customer_read_at DATETIME NULL`);
  await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS support_read_at DATETIME NULL`);
  await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS attachments TEXT NULL`);
  // What a message used to say.
  //
  // Kept rather than overwritten because a support thread is a record of what
  // was agreed. Silently rewriting a line of it would make the conversation
  // unreliable evidence of itself — somebody could ask for one thing, be
  // answered, and then edit the asking.
  //
  // A JSON array of { body, at }, oldest first. On the message rather than in a
  // table of its own: edits are rare, few, and only ever read alongside the
  // message they belong to.
  await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS previous_bodies TEXT NULL`);
  await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS edited_at DATETIME NULL`);

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
      -- JSON array of { name, file, bytes }. A message rarely has any, and
      -- never has many, so a column costs less than a table and a join.
      attachments TEXT NULL,
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

  // The shared numbering for everything a customer enters.
  //
  // An expense, a vehicle trip and an hour worked from home each had their own
  // auto-increment id, so "number 14" meant three different things depending
  // on which list you were reading. This table's AUTO_INCREMENT is the one
  // sequence all three draw from.
  //
  // A table rather than a counter in settings, because allocation has to be
  // atomic: read-add-write hands the same number to two people who save in the
  // same instant. An INSERT cannot do that.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entry_numbers (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=62000000
  `);
  // Only ever raises it, and that is the only direction it can safely go.
  //
  // AUTO_INCREMENT cannot be set below the highest value the table already
  // holds — MariaDB silently keeps the higher one — so this is a floor rather
  // than an assignment. It moved from 61320000 to 62000000 so that every
  // reference reads 62xxxxxx; raising works, and the rows already issued below
  // it are renumbered by backfillEntryNumbers rather than reused.
  await pool.query(`ALTER TABLE entry_numbers AUTO_INCREMENT = ${FIRST_ENTRY_NUMBER}`);

  for (const table of ['expenses', 'vehicle_trips', 'home_office_hours']) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS entry_no BIGINT UNSIGNED NULL`);
    // Unique per table, and unique across them by construction — every number
    // comes from the one sequence, and a sequence does not repeat.
    await pool.query(`ALTER TABLE ${table} ADD UNIQUE INDEX IF NOT EXISTS uq_${table}_entry_no (entry_no)`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_identity_reveals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      ticket_id INT NOT NULL,
      staff_user_id INT NOT NULL,
      revealed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_reveal_ticket (ticket_id),
      KEY idx_reveal_staff (staff_user_id, revealed_at),
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Every time somebody on the team asks who a ticket belongs to.
  //
  // The support queue shows a pseudonym rather than a customer's name and
  // face; the name is one request away when the job needs it, and this is what
  // makes that request cost something. Without it, hiding the name would be a
  // speed bump nobody could audit — and a protection nobody can check is not a
  // protection, it is a claim.
  //
  // Not unique on (ticket, staff): the interesting question is how often, not
  // whether. Cascades on both sides, so deleting a ticket or an account takes
  // its trail with it rather than leaving rows pointing at nothing.
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

  // Money that has actually arrived.
  //
  // Stripe knows all of this, but answering "what came in this week" meant
  // calling Stripe on every page load, paging through invoices and matching
  // customers back to accounts. Written down as it happens instead, so the
  // admin panel can read it like any other table — and so a Stripe outage
  // costs a page nothing.
  //
  // stripe_invoice_id is unique because webhooks are delivered more than once.
  // Without it a retried delivery counts the same payment twice, and a total
  // that overstates takings is worse than no total.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NULL,
      stripe_invoice_id VARCHAR(255) NOT NULL,
      amount_cents INT NOT NULL,
      currency VARCHAR(10) NOT NULL,
      -- subscription | plan_change. What the money was for, so a renewal and
      -- a one-off can be told apart without reading the description.
      kind VARCHAR(20) NOT NULL DEFAULT 'subscription',
      description VARCHAR(300) NULL,
      invoice_url VARCHAR(500) NULL,
      paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_payment_invoice (stripe_invoice_id),
      KEY idx_payments_when (paid_at),
      -- The payment outlives the account. Somebody deleting their account
      -- does not unmake the money, and a takings figure that changes when
      -- somebody leaves is not a takings figure.
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Stamped when the administrators have been told about a payment.
  //
  // Stripe delivers a webhook more than once, so "have we sent this already"
  // has to be a fact in the database rather than something the process
  // remembers — a restart between two deliveries would otherwise send it
  // twice.
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS notified_admins_at DATETIME NULL`);

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

  // Numbers for everything entered before the shared sequence existed.
  //
  // Idempotent by its WHERE clause — it only touches rows without a number —
  // so it runs on every boot and does nothing at all after the first. Left
  // unguarded by a settings flag deliberately: a flag can be set while the
  // work is half done, and this cannot.
  const numbered = await backfillEntryNumbers(pool);
  if (numbered) console.log(`[db] numbered ${numbered} entr${numbered === 1 ? 'y' : 'ies'}`);
}

export async function getSetting(key) {
  const [rows] = await pool.execute('SELECT value FROM settings WHERE `key` = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await pool.execute('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [key, value, value]);
}

// Always required, and no longer a setting.
//
// This app holds people's tax records and lets an accountant read them. There
// is no version of that where a password alone is enough, and a switch that
// could turn it off was a switch that would eventually be turned off — by
// somebody in a hurry, for one account, permanently.
//
// The stored value is ignored rather than deleted, so an install that had it
// set to optional simply stops honouring it on the next restart.
export async function getMfaMode() {
  return 'required';
}

export default pool;
