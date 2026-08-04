import { sendBookTaxReminderEmail, sendTaxAppointmentReminderEmail } from '../lib/mailer.js';
import { financialYearOf } from '../lib/financialYear.js';
import { lodgementPeriodsFor, normaliseCadence } from '../lib/lodgementPeriods.js';
import { notify } from '../lib/notify.js';

// Two emails, at most, per lodgement — and only when there is something worth
// saying. The restraint is the feature: a reminder that arrives every week is
// one people filter out, and then the one that mattered goes with it.
//
//   1. Book your appointment — sent once, as a lodgement approaches, and never
//      to someone who has already entered a date.
//   2. Your appointment is tomorrow — sent once, only because they asked for
//      it by entering the date themselves.
//
// A lodgement is a whole year for an individual and a quarter for a business
// that reports quarterly, so this runs per set of books rather than per person.

// How far ahead to warn, by cadence. Ninety days before a year end is the point
// where accountants start filling up. Ninety days before a quarter end is the
// first day of the quarter, which is not a warning, it is noise.
const BOOKING_WINDOW_DAYS = { annual: 90, quarterly: 21 };

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

  // --- 1. Book your appointment ------------------------------------------
  //
  // One row per set of books, not per person: an individual and two businesses
  // are three separate returns on three separate deadlines, and only the books
  // with something in them have a lodgement worth booking.
  const [entities] = await pool.execute(
    `SELECT e.id AS entity_id, e.name AS entity_name, e.lodgement_cadence, e.is_default,
            u.id AS user_id, u.email, u.first_name, u.name, u.fy_start_month, u.fy_start_day,
            (SELECT COUNT(*) FROM expenses x WHERE x.entity_id = e.id AND x.deleted_at IS NULL) AS expense_count
     FROM entities e
     JOIN users u ON u.id = e.user_id
     WHERE e.archived_at IS NULL
       AND u.activated_at IS NOT NULL
       AND (u.subscription_status IN ('active', 'trialing') OR u.access_bypass = 1)`
  );

  for (const books of entities) {
    // Books with nothing in them have no tax position to take to anyone, so the
    // reminder would be an advert rather than a service.
    if (Number(books.expense_count) === 0) continue;

    const rule = { startMonth: books.fy_start_month, startDay: books.fy_start_day };
    const cadence = normaliseCadence(books.lodgement_cadence);
    const financialYear = financialYearOf(today, rule);
    const periods = lodgementPeriodsFor(financialYear, rule, cadence);
    if (periods.length === 0) continue;

    // The period today falls in — that is the one whose deadline is next.
    const current = periods.find((p) => today >= p.start && today <= p.end);
    if (!current) continue;

    const daysLeft = daysBetween(now, new Date(`${current.end}T00:00:00`));
    if (daysLeft <= 0 || daysLeft > BOOKING_WINDOW_DAYS[cadence]) continue;

    // Already reminded, already booked, or already done for this lodgement.
    const [[existing]] = await pool.execute(
      `SELECT booking_reminder_sent_at, appointment_at, finalised_at FROM tax_years
       WHERE user_id = ? AND entity_id = ? AND financial_year = ? AND period = ?`,
      [books.user_id, books.entity_id, financialYear, current.period]
    );
    if (existing && (existing.booking_reminder_sent_at || existing.appointment_at || existing.finalised_at)) {
      continue;
    }

    // The default entity is the whole of most people's tax, so naming it would
    // read as clutter. A second set of books needs saying.
    const whose = books.is_default ? null : books.entity_name;

    try {
      await sendBookTaxReminderEmail(
        books.email,
        books.first_name || books.name,
        current.label,
        formatDate(current.end),
        daysLeft,
        Number(books.expense_count),
        whose
      );
      // entity_id and period are not optional here. This is an upsert against
      // the unique key on tax_years, and that key includes both — so without
      // them "duplicate" would mean something different and this would insert a
      // fresh row every twelve hours, forever, without complaining.
      await pool.execute(
        `INSERT INTO tax_years (user_id, entity_id, financial_year, period, booking_reminder_sent_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE booking_reminder_sent_at = NOW()`,
        [books.user_id, books.entity_id, financialYear, current.period]
      );
      // The same thing in the app, so it is still findable after the email has
      // been archived — which is where tax reminders usually end up.
      await notify(books.user_id, {
        title: `${current.label}${whose ? ` — ${whose}` : ''} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        body: `You have ${books.expense_count} expense${Number(books.expense_count) === 1 ? '' : 's'} recorded. Book your appointment and set the date in Tax years.`,
        url: '/reports',
        kind: 'tax-year',
      });
    } catch (err) {
      console.error(`Failed to send tax booking reminder to ${books.email}`, err.message);
    }
  }

  // --- 2. Your appointment is tomorrow ------------------------------------
  // Anything in the next 48 hours that hasn't been reminded about yet. The
  // window is wide enough that a job running once a day cannot skip one.
  const [appointments] = await pool.execute(
    `SELECT t.id, t.user_id, t.financial_year, t.period, t.appointment_at, t.appointment_company,
            t.appointment_accountant, u.email, u.first_name, u.name,
            e.name AS entity_name, e.is_default AS entity_is_default
     FROM tax_years t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN entities e ON e.id = t.entity_id
     WHERE t.appointment_at IS NOT NULL
       AND t.appointment_reminder_sent_at IS NULL
       AND t.appointment_at > NOW()
       AND t.appointment_at <= DATE_ADD(NOW(), INTERVAL 48 HOUR)`
  );

  for (const row of appointments) {
    // Someone with three sets of books has three appointments, so the one this
    // is about has to be named. The default entity is most people's whole tax,
    // where naming it would only read as clutter.
    const whose = row.entity_name && !row.entity_is_default ? row.entity_name : null;
    try {
      await sendTaxAppointmentReminderEmail(
        row.email,
        row.first_name || row.name,
        whose ? `${row.financial_year} — ${whose}` : row.financial_year,
        formatDateTime(row.appointment_at),
        row.appointment_company || 'your accountant',
        row.appointment_accountant
      );
      await pool.execute('UPDATE tax_years SET appointment_reminder_sent_at = NOW() WHERE id = ?', [row.id]);
      await notify(row.user_id, {
        title: whose ? `Tax appointment for ${whose} is coming up` : 'Your tax appointment is coming up',
        body: `${formatDateTime(row.appointment_at)} with ${row.appointment_company || 'your accountant'}.`,
        url: '/reports',
        kind: 'appointment',
      });
    } catch (err) {
      console.error(`Failed to send tax appointment reminder to ${row.email}`, err.message);
    }
  }

  // --- 3. Your free trial is ending ---------------------------------------
  // Sent once, three days out. Losing access to your own records because a
  // trial quietly lapsed is the kind of surprise that costs a customer, and
  // three days is enough time to do something about it.
  const [trials] = await pool.execute(
    `SELECT u.id, u.trial_ends_at
     FROM users u
     WHERE u.subscription_status = 'trialing'
       AND u.access_bypass = 0
       AND u.trial_ends_at IS NOT NULL
       AND u.trial_ends_at > NOW()
       AND u.trial_ends_at <= DATE_ADD(NOW(), INTERVAL 3 DAY)
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id = u.id AND n.kind = 'trial'
           AND n.created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
       )`
  );

  for (const user of trials) {
    const daysLeft = Math.max(1, daysBetween(now, new Date(user.trial_ends_at)));
    await notify(user.id, {
      title: `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      body: 'Choose a plan to keep adding expenses and running reports. Everything you have recorded stays where it is.',
      url: '/account',
      kind: 'trial',
    });
  }
}
