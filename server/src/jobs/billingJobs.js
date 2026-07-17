import { sendTrialEndingEmail, sendTrialExpiredEmail, sendSubscriptionRenewingEmail } from '../lib/mailer.js';

export async function purgeUnactivatedAccounts(pool) {
  await pool.query(`DELETE FROM users WHERE activated_at IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 5 DAY)`);
}

async function alreadySent(pool, userId, key) {
  const [rows] = await pool.execute('SELECT id FROM sent_reminders WHERE user_id = ? AND reminder_key = ?', [userId, key]);
  return rows.length > 0;
}

async function markSent(pool, userId, key) {
  await pool.execute('INSERT IGNORE INTO sent_reminders (user_id, reminder_key) VALUES (?, ?)', [userId, key]);
}

export async function runBillingReminders(pool) {
  for (const days of [7, 3, 1]) {
    const [rows] = await pool.execute(
      `SELECT id, email, name, trial_ends_at FROM users
       WHERE role = 'owner' AND subscription_status = 'trialing' AND trial_ends_at IS NOT NULL
         AND trial_ends_at BETWEEN DATE_ADD(NOW(), INTERVAL ${days - 1} DAY) AND DATE_ADD(NOW(), INTERVAL ${days} DAY)`
    );
    for (const u of rows) {
      const key = `trial_${days}d`;
      if (await alreadySent(pool, u.id, key)) continue;
      try {
        await sendTrialEndingEmail(u.email, u.name, days, u.trial_ends_at);
        await markSent(pool, u.id, key);
      } catch (err) {
        console.error('Failed to send trial-ending email', err);
      }
    }
  }

  for (const days of [7, 1]) {
    const [rows] = await pool.execute(
      `SELECT id, email, name, subscription_current_period_end FROM users
       WHERE role = 'owner' AND subscription_status = 'active' AND subscription_current_period_end IS NOT NULL
         AND subscription_current_period_end BETWEEN DATE_ADD(NOW(), INTERVAL ${days - 1} DAY) AND DATE_ADD(NOW(), INTERVAL ${days} DAY)`
    );
    for (const u of rows) {
      const key = `renewal_${days}d`;
      if (await alreadySent(pool, u.id, key)) continue;
      try {
        await sendSubscriptionRenewingEmail(u.email, u.name, u.subscription_current_period_end);
        await markSent(pool, u.id, key);
      } catch (err) {
        console.error('Failed to send renewal reminder email', err);
      }
    }
  }

  const [expired] = await pool.execute(
    `SELECT id, email, name FROM users
     WHERE role = 'owner' AND subscription_status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()`
  );
  for (const u of expired) {
    await pool.execute(`UPDATE users SET subscription_status = 'expired' WHERE id = ?`, [u.id]);
    const key = 'trial_expired';
    if (await alreadySent(pool, u.id, key)) continue;
    try {
      await sendTrialExpiredEmail(u.email, u.name);
      await markSent(pool, u.id, key);
    } catch (err) {
      console.error('Failed to send trial-expired email', err);
    }
  }
}
