import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import RecentPayments from './RecentPayments.jsx';
import Avatar from './Avatar.jsx';
import { formatDateShort, formatDateTime } from '../lib/dates.js';

// Slow enough not to hammer the database, fast enough that "live" is honest.
// The window for counting somebody online is five minutes, so a ten-second
// refresh is already far finer than the underlying number.
const REFRESH_MS = 10000;

function Delta({ change }) {
  if (!change) return null;
  const { direction, percent } = change;
  const colour = direction === 'up' ? 'var(--emerald)' : direction === 'down' ? 'var(--red)' : 'var(--text-muted)';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  // percent is null when the previous period was zero — there is no percentage
  // change from nothing, and "+Infinity%" is not an improvement on saying so.
  const text = percent === null ? 'new' : `${Math.abs(percent)}%`;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: colour, whiteSpace: 'nowrap' }}>
      {arrow} {text}
    </span>
  );
}

function Stat({ label, value, hint, change, accent, live }) {
  return (
    <div
      className="card"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        // The accent is a rail rather than a fill: six saturated cards side by
        // side is a toy, and nothing on it stands out because everything does.
        borderLeft: `3px solid ${accent || 'var(--border)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {label}
        </span>
        {live && <LiveDot />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        <Delta change={change} />
      </div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  );
}

function LiveDot() {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
      <motion.span
        animate={{ opacity: [0.9, 0.15, 0.9] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--emerald)' }}
      />
    </span>
  );
}

// A bar per day, drawn as divs. A charting library for two series of thirty
// integers would be more code to configure than this is to write, and another
// 60 kB in a bundle that has already been trimmed once.
function BarChart({ data, colour, label }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {total} in {data.length} days · peak {max}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110 }}>
        {data.map((d) => (
          <div
            key={d.date}
            title={`${formatDateShort(d.date)} — ${d.count}`}
            style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'flex-end', height: '100%' }}
          >
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(d.count ? 6 : 2, (d.count / max) * 100)}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              style={{
                width: '100%',
                borderRadius: '3px 3px 0 0',
                // An empty day is a visible trough, not a gap — a missing bar
                // reads as "no data" when it means "nobody came".
                background: d.count ? colour : 'var(--border)',
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
        <span>{formatDateShort(data[0]?.date)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

const DEVICE_LABEL = {
  'android-app': 'Android app',
  mobile: 'Mobile browser',
  tablet: 'Tablet',
  desktop: 'Desktop',
  unknown: 'Unknown',
};

// Colour belongs to the kind of device, not to its position in the list.
//
// Picking by index meant every refresh could repaint the chart: the page
// reloads every ten seconds, and the moment two counts crossed — or merely
// tied — the segments swapped places and swapped colours with them. A legend
// whose colours move is worse than no legend, because it is read as the data
// having changed.
const DEVICE_COLOUR = {
  'android-app': 'var(--emerald)',
  mobile: 'var(--accent)',
  tablet: 'var(--amber)',
  desktop: '#7c6bd8',
  unknown: 'var(--text-muted)',
};
const FALLBACK_COLOUR = 'var(--border)';

// Where sign-ups say they came from, as a share of those who answered.
//
// The share is of people who answered, not of all accounts, and the card says
// so underneath. Mixing the two lets a run of blanks quietly halve every
// channel and read as a campaign going cold when nothing has changed but the
// number of people who skipped an optional question.
function ReferralSplit({ data }) {
  if (!data || !data.sources.length) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Nobody has answered this yet.
      </div>
    );
  }

  const top = data.sources[0].count || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {data.sources.map((row) => (
        <div key={row.source} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.source}
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{row.percent}%</strong>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>
              {row.count}
            </span>
          </div>
          {/* Scaled to the biggest answer rather than to 100, so the shape of
              the list is readable when the leader is only on 20%. */}
          <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-inset)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(3, (row.count / top) * 100)}%`,
                height: '100%',
                borderRadius: 3,
                background: 'var(--accent)',
              }}
            />
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 2 }}>
        Share of the {data.answered} account{data.answered === 1 ? '' : 's'} that answered
        {data.accounts > data.answered && `, of ${data.accounts} in total`}. Deleted accounts stop counting.
      </div>
    </div>
  );
}

function DeviceSplit({ devices }) {
  const total = devices.reduce((sum, d) => sum + d.count, 0);
  if (!total) return <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No sign-ins in the last 30 days.</div>;

  // Ordered here as well as in SQL, so the row cannot depend on what the
  // database happened to return.
  const ordered = [...devices].sort((a, b) => b.count - a.count || a.device.localeCompare(b.device));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-subtle)' }}>
        {ordered.map((d) => (
          <div
            key={d.device}
            title={`${DEVICE_LABEL[d.device] || d.device} — ${d.count}`}
            style={{ width: `${(d.count / total) * 100}%`, background: DEVICE_COLOUR[d.device] || FALLBACK_COLOUR }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {ordered.map((d) => (
          <span key={d.device} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: DEVICE_COLOUR[d.device] || FALLBACK_COLOUR }}
            />
            {DEVICE_LABEL[d.device] || d.device}
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{d.count}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function PersonRow({ person, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <Avatar name={person.name} avatarUrl={person.avatarUrl} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {person.name}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {person.email}
        </div>
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{right}</span>
    </div>
  );
}

function Panel({ title, icon, children, live }) {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        {live && <LiveDot />}
      </div>
      {children}
    </div>
  );
}

export default function AdminStatsTab({ onHowItWorks }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  // Held in a ref as well: the interval callback closes over its first render,
  // so reading state inside it would always see null.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    async function load() {
      try {
        const res = await api.get('/admin/stats');
        if (!alive.current) return;
        setStats(res.data);
        setError('');
        setUpdatedAt(new Date());
      } catch (err) {
        // The previous numbers stay on screen. A page that empties itself
        // because one poll failed is worse than one showing figures a few
        // seconds stale, and it says which it is.
        if (alive.current) setError(err.message);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  if (!stats) {
    return (
      <div className="card" style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        {error || 'Loading…'}
      </div>
    );
  }

  const { totals, active, signups, series, devices } = stats;
  const conversion = totals.users ? Math.round((totals.subscribed / totals.users) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {error ? (
            <span style={{ color: 'var(--amber)' }}>Showing the last good figures — {error}</span>
          ) : (
            <>Updated {updatedAt ? formatDateTime(updatedAt) : '—'} · refreshes every {REFRESH_MS / 1000}s</>
          )}
        </div>

        {/* The map of how the system works, from the page somebody is most often
            looking at when they wonder. */}
        {onHowItWorks && (
          <button className="btn btn-ghost" style={{ fontSize: 12.5, gap: 6 }} onClick={onHowItWorks}>
            <Icon name="info" size={14} />
            How it works
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))' }}>
        <Stat
          label="Online now"
          value={stats.online}
          hint={`Active in the last ${stats.onlineWindowMinutes} minutes`}
          accent="var(--emerald)"
          live
        />
        <Stat label="Today" value={active.today} hint="People who used Taxify today" accent="var(--accent)" />
        <Stat label="This week" value={active.week} hint="Used it in the last 7 days" accent="var(--accent)" />
        <Stat label="This month" value={active.month} hint="Used it in the last 30 days" accent="var(--accent)" />
        <Stat
          label="New this week"
          value={signups.week}
          change={signups.weekChange}
          hint="Against the week before"
          accent="var(--amber)"
        />
        <Stat
          label="New this month"
          value={signups.month}
          change={signups.monthChange}
          hint="Against the month before"
          accent="var(--amber)"
        />
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))' }}>
        <Stat label="Accounts" value={totals.users} hint={`${totals.activated} activated`} />
        <Stat label="Subscribed" value={totals.subscribed} hint={`${conversion}% of all accounts`} accent="var(--emerald)" />
        <Stat label="On trial" value={totals.trialing} hint="Not yet paying" />
      </div>

      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <BarChart data={series.visits} colour="var(--accent)" label={`People using Taxify — last ${series.days} days`} />
        <BarChart data={series.signups} colour="var(--emerald)" label={`New registrations — last ${series.days} days`} />
      </div>

      {/* Above the two who-is-here panels: what came in matters more than who
          happens to be logged in, and it was the one thing this page could not
          answer at all. */}
      <RecentPayments />

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <Panel title="Here right now" icon="users" live>
          {stats.onlineUsers.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Nobody is using Taxify at the moment.</div>
          ) : (
            <div>
              {stats.onlineUsers.map((u) => (
                <PersonRow key={u.id} person={u} right={formatDateTime(u.lastSeenAt).split(' ').pop()} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Newest accounts" icon="user">
          {stats.recentSignups.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No accounts yet.</div>
          ) : (
            <div>
              {stats.recentSignups.map((u) => (
                <PersonRow
                  key={u.id}
                  person={u}
                  right={u.activated ? formatDateShort(u.createdAt) : 'Not activated'}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="How people sign in" icon="phone">
          <DeviceSplit devices={devices} />
        </Panel>

        <Panel title="How people heard about us" icon="chart">
          <ReferralSplit data={stats.referralSources} />
        </Panel>
      </div>
    </div>
  );
}
