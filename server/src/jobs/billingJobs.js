import {
  sendTrialEndingEmail,
  sendTrialExpiredEmail,
  sendSubscriptionRenewingEmail,
  sendActivationReminderEmail,
} from '../lib/mailer.js';
import { generateActivationToken } from '../auth/activationToken.js';
import { publicOrigin } from '../lib/publicOrigin.js';

const UNACTIVATED_LIFETIME_DAYS = 5;

// An account that was never activated is deleted after five days. Before that
// happens the person gets a nudge, because the usual reason a sign-up stalls
// is a first email that went to spam or got buried, not a change of mind.
//
// Reminders go out with days remaining, not days elapsed — "expires in 1 day"
// is the part that matters to the reader.
//
// Accountants are excluded from both halves, and that is not tidying-up. An
// invited accountant's row is unactivated through no fault of their own — their
// client created it — and deleting it took the client's grant with it by
// cascade, silently, with the client never told their accountant had vanished
// from the list. The reminder was wrong for them too: it links to /activate,
// which is not the page an invitation leads to.
const NOT_AN_ACCOUNTANT = `role <> 'accountant'`;

export async function purgeUnactivatedAccounts(pool) {
  for (const daysLeft of [2, 1]) {
    const elapsed = UNACTIVATED_LIFETIME_DAYS - daysLeft;
    const [rows] = await pool.execute(
      `SELECT id, email, name, first_name FROM users
       WHERE activated_at IS NULL
         AND ${NOT_AN_ACCOUNTANT}
         AND created_at BETWEEN DATE_SUB(NOW(), INTERVAL ${elapsed + 1} DAY) AND DATE_SUB(NOW(), INTERVAL ${elapsed} DAY)`
    );

    for (const user of rows) {
      const key = `activation_${daysLeft}d`;
      if (await alreadySent(pool, user.id, key)) continue;

      // The stored token is a hash, so the original can't be recovered — the
      // reminder carries a fresh one, which also gives a stalled sign-up a
      // link that hasn't expired.
      const { token, tokenHash, expiresAt } = generateActivationToken();
      await pool.execute('UPDATE users SET activation_token_hash = ?, activation_token_expires_at = ? WHERE id = ?', [
        tokenHash,
        expiresAt,
        user.id,
      ]);

      const url = `${publicOrigin()}/activate?token=${token}`;
      try {
        await sendActivationReminderEmail(user.email, user.first_name || user.name, url, daysLeft);
        await markSent(pool, user.id, key);
      } catch (err) {
        console.error(`Failed to send activation reminder to ${user.email}`, err.message);
      }
    }
  }

  const [result] = await pool.query(
    `DELETE FROM users
     WHERE activated_at IS NULL
       AND ${NOT_AN_ACCOUNTANT}
       AND created_at < DATE_SUB(NOW(), INTERVAL ${UNACTIVATED_LIFETIME_DAYS} DAY)`
  );
  if (result.affectedRows > 0) {
    console.log(`[cleanup] removed ${result.affectedRows} account(s) that were never activated`);
  }
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
