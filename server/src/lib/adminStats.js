import pool from '../db.js';
import { ONLINE_WINDOW_MINUTES } from './presence.js';

// How many days the chart covers. Long enough to see a trend, short enough
// that the query stays a single indexed scan.
const SERIES_DAYS = 30;

// Growth as a percentage, with the cases that break naive division named.
// Nothing to nothing is flat, not infinite; something from nothing is new
// rather than "+Infinity%".
function change(current, previous) {
  if (!previous && !current) return { direction: 'flat', percent: 0 };
  if (!previous) return { direction: 'up', percent: null };
  const percent = Math.round(((current - previous) / previous) * 100);
  return { direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat', percent };
}

// A row per day for the whole window, including the days nothing happened.
// SQL only returns days that have rows, and a chart with the empty days
// missing draws a straight line through them — which reads as steady use
// rather than none.
function fillDays(rows, days, key = 'day') {
  const byDay = new Map(rows.map((r) => [String(r[key]).slice(0, 10), Number(r.count) || 0]));
  const out = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const iso = cursor.toISOString().slice(0, 10);
    out.push({ date: iso, count: byDay.get(iso) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export async function collectStats() {
  // Everything below counts real account holders. Accountants invited to read
  // somebody else's books are not customers, and counting them makes both
  // "how many users" and "is this growing" wrong.
  const OWNERS = `role = 'owner'`;

  const [[online]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users
      WHERE ${OWNERS} AND last_seen_at IS NOT NULL
        AND last_seen_at >= NOW() - INTERVAL ? MINUTE`,
    [ONLINE_WINDOW_MINUTES]
  );

  // Active = made a request, not merely signed in. Someone who stays signed in
  // for a month and uses Taxify daily has one login event and thirty active
  // days, and it is the thirty that describe the product.
  const [[activeToday]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE ${OWNERS} AND last_seen_at >= CURDATE()`
  );
  const [[activeWeek]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE ${OWNERS} AND last_seen_at >= NOW() - INTERVAL 7 DAY`
  );
  const [[activeMonth]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE ${OWNERS} AND last_seen_at >= NOW() - INTERVAL 30 DAY`
  );

  const [[totals]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(activated_at IS NOT NULL) AS activated,
       SUM(subscription_status = 'active') AS subscribed,
       SUM(subscription_status = 'trialing') AS trialing
     FROM users WHERE ${OWNERS}`
  );

  // This week against last week, and this month against the one before, so the
  // number arrives with the only context that makes it mean anything.
  const [[signupsWeek]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE ${OWNERS} AND created_at >= NOW() - INTERVAL 7 DAY`
  );
  const [[signupsPrevWeek]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users
      WHERE ${OWNERS} AND created_at >= NOW() - INTERVAL 14 DAY AND created_at < NOW() - INTERVAL 7 DAY`
  );
  const [[signupsMonth]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE ${OWNERS} AND created_at >= NOW() - INTERVAL 30 DAY`
  );
  const [[signupsPrevMonth]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users
      WHERE ${OWNERS} AND created_at >= NOW() - INTERVAL 60 DAY AND created_at < NOW() - INTERVAL 30 DAY`
  );

  const [signupSeries] = await pool.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM users
      WHERE ${OWNERS} AND created_at >= CURDATE() - INTERVAL ? DAY
      GROUP BY DATE(created_at) ORDER BY day`,
    [SERIES_DAYS - 1]
  );

  // Distinct people per day, from sign-ins. last_seen_at is a single moment
  // and cannot answer "how many were here last Tuesday" — login_events can,
  // and it is the only history that exists for days before this page did.
  const [visitSeries] = await pool.query(
    `SELECT DATE(at) AS day, COUNT(DISTINCT user_id) AS count FROM login_events
      WHERE at >= CURDATE() - INTERVAL ? DAY
      GROUP BY DATE(at) ORDER BY day`,
    [SERIES_DAYS - 1]
  );

  const [devices] = await pool.query(
    `SELECT COALESCE(device, 'unknown') AS device, COUNT(DISTINCT user_id) AS count
       FROM login_events WHERE at >= NOW() - INTERVAL 30 DAY
      GROUP BY COALESCE(device, 'unknown') ORDER BY count DESC`
  );

  // Who is here right now, by name. The number alone is not much use at the
  // scale this runs at — with four people online, which four is the question.
  const [onlineUsers] = await pool.query(
    `SELECT id, name, email, avatar_path, last_seen_at FROM users
      WHERE ${OWNERS} AND last_seen_at >= NOW() - INTERVAL ? MINUTE
      ORDER BY last_seen_at DESC LIMIT 20`,
    [ONLINE_WINDOW_MINUTES]
  );

  const [recentSignups] = await pool.query(
    `SELECT id, name, email, avatar_path, created_at, activated_at FROM users
      WHERE ${OWNERS} ORDER BY created_at DESC LIMIT 8`
  );

  return {
    onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
    online: Number(online.count) || 0,
    active: {
      today: Number(activeToday.count) || 0,
      week: Number(activeWeek.count) || 0,
      month: Number(activeMonth.count) || 0,
    },
    totals: {
      users: Number(totals.total) || 0,
      activated: Number(totals.activated) || 0,
      subscribed: Number(totals.subscribed) || 0,
      trialing: Number(totals.trialing) || 0,
    },
    signups: {
      week: Number(signupsWeek.count) || 0,
      month: Number(signupsMonth.count) || 0,
      weekChange: change(Number(signupsWeek.count) || 0, Number(signupsPrevWeek.count) || 0),
      monthChange: change(Number(signupsMonth.count) || 0, Number(signupsPrevMonth.count) || 0),
    },
    series: {
      days: SERIES_DAYS,
      signups: fillDays(signupSeries, SERIES_DAYS),
      visits: fillDays(visitSeries, SERIES_DAYS),
    },
    devices: devices.map((d) => ({ device: d.device, count: Number(d.count) || 0 })),
    onlineUsers: onlineUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatar_path ? `/api/auth/avatar/${u.id}` : null,
      lastSeenAt: u.last_seen_at,
    })),
    recentSignups: recentSignups.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatar_path ? `/api/auth/avatar/${u.id}` : null,
      createdAt: u.created_at,
      activated: Boolean(u.activated_at),
    })),
  };
}

export { change as changeBetween, fillDays };
