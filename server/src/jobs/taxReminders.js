import { sendBookTaxReminderEmail, sendTaxAppointmentReminderEmail } from '../lib/mailer.js';
import { financialYearOf, financialYearRange } from '../lib/financialYear.js';

// Two emails, at most, per financial year — and only when there is something
// worth saying. The restraint is the feature: a reminder that arrives every
// week is one people filter out, and then the one that mattered goes with it.
//
//   1. Book your appointment — sent once, inside the last three months of the
//      year, and never to someone who has already entered a date.
//   2. Your appointment is tomorrow — sent once, only because they asked for
//      it by entering the date themselves.

const BOOKING_WINDOW_DAYS = 90;

function daysBetween(from, to) {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(value) {
  const [datePart, timePart = '00:00:00'] = String(value).replace('T', ' ').split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const local = new Date(y, m - 1, d, hh, mm);
  return local.toLocaleString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function runTaxReminders(pool) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const financialYear = financialYearOf(today);
  const range = financialYearRange(financialYear);
  if (!range) return;

  const endsOn = new Date(`${range.end}T00:00:00`);
  const daysLeft = daysBetween(now, endsOn);

  // --- 1. Book your appointment ------------------------------------------
  // Only inside the last three months, and only for people who can actually
  // use the app — reminding a lapsed account to book is just noise.
  if (daysLeft > 0 && daysLeft <= BOOKING_WINDOW_DAYS) {
    const [candidates] = await pool.execute(
      `SELECT u.id, u.email, u.first_name, u.name,
              (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id AND e.deleted_at IS NULL) AS expense_count
       FROM users u
       LEFT JOIN tax_years t ON t.user_id = u.id AND t.financial_year = ?
       WHERE u.role = 'owner'
         AND u.activated_at IS NOT NULL
         AND (u.subscription_status IN ('active', 'trialing') OR u.access_bypass = 1)
         AND t.booking_reminder_sent_at IS NULL
         AND t.appointment_at IS NULL
         AND (t.id IS NULL OR t.finalised_at IS NULL)`,
      [financialYear]
    );

    for (const user of candidates) {
      // Someone with nothing recorded has no tax position to take to anyone,
      // so the reminder would be an advert rather than a service.
      if (Number(user.expense_count) === 0) continue;

      try {
        await sendBookTaxReminderEmail(
          user.email,
          user.first_name || user.name,
          financialYear,
          formatDate(range.end),
          daysLeft,
          Number(user.expense_count)
        );
        await pool.execute(
          `INSERT INTO tax_years (user_id, financial_year, booking_reminder_sent_at)
           VALUES (?, ?, NOW())
           ON DUPLICATE KEY UPDATE booking_reminder_sent_at = NOW()`,
          [user.id, financialYear]
        );
      } catch (err) {
        console.error(`Failed to send tax booking reminder to ${user.email}`, err.message);
      }
    }
  }

  // --- 2. Your appointment is tomorrow ------------------------------------
  // Anything in the next 48 hours that hasn't been reminded about yet. The
  // window is wide enough that a job running once a day cannot skip one.
  const [appointments] = await pool.execute(
    `SELECT t.id, t.financial_year, t.appointment_at, t.appointment_company, t.appointment_accountant,
            u.email, u.first_name, u.name
     FROM tax_years t
     JOIN users u ON u.id = t.user_id
     WHERE t.appointment_at IS NOT NULL
       AND t.appointment_reminder_sent_at IS NULL
       AND t.appointment_at > NOW()
       AND t.appointment_at <= DATE_ADD(NOW(), INTERVAL 48 HOUR)`
  );

  for (const row of appointments) {
    try {
      await sendTaxAppointmentReminderEmail(
        row.email,
        row.first_name || row.name,
        row.financial_year,
        formatDateTime(row.appointment_at),
        row.appointment_company || 'your accountant',
        row.appointment_accountant
      );
      await pool.execute('UPDATE tax_years SET appointment_reminder_sent_at = NOW() WHERE id = ?', [row.id]);
    } catch (err) {
      console.error(`Failed to send tax appointment reminder to ${row.email}`, err.message);
    }
  }
}
