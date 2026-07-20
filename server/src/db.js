import { INITIAL_DEFAULT_CATEGORIES } from './seed/defaultCategories.js';
import { proxyPool } from './tenant/tenants.js';

// `pool` is a proxy that routes every query to whichever tenant is
// active on the current request's AsyncLocalStorage context (see
// tenant/tenants.js). Every call site below and throughout the app
// keeps calling pool.query/execute exactly as before — the tenant
// resolution is invisible here.
const pool = proxyPool;

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

  const [existing] = await pool.query('SELECT COUNT(*) AS count FROM default_categories');
  if (existing[0].count === 0) {
    for (const c of INITIAL_DEFAULT_CATEGORIES) {
      await pool.execute('INSERT INTO default_categories (name, color, icon) VALUES (?, ?, ?)', [c.name, c.color, c.icon]);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(64) PRIMARY KEY,
      value VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  `);
  await pool.query(`
    INSERT IGNORE INTO settings (\`key\`, value) VALUES ('registration_enabled', 'true')
  `);
  await pool.query(`
    INSERT IGNORE INTO settings (\`key\`, value) VALUES ('mfa_mode', 'optional')
  `);
  await pool.query(`
    INSERT IGNORE INTO settings (\`key\`, value) VALUES ('server_name', 'Taxify')
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

export async function getServerName() {
  const name = await getSetting('server_name');
  return name || 'Taxify';
}

export default pool;
