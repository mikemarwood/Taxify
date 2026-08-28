import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';

// The wall display.
//
// Cast to a television or left full-screen on a spare monitor, so it is read
// from across a room rather than from a desk. That is not the same as making
// everything enormous, which is what the first version did: four numbers at
// 76px with nothing quieter around them gives the eye nowhere to rest and no
// sense of which figure matters more than the others.
//
// So the scale is deliberate. One headline figure per tile at a size that
// carries across a room, a label above it that does not compete with it, and a
// line of context underneath in ordinary text. Everything else — the charts,
// the feeds — sits at reading size, because that is detail somebody walks over
// to look at rather than something to be legible from the doorway.
//
// New sign-ups are named; payments are not. That split is deliberate and was
// asked for: seeing who has just joined is most of the point of watching this,
// and a name stays on screen only while it is in the last eight. What is kept
// off it is who paid what — the amount, the plan and the country say how the
// business is doing without attaching a sum of money to a person on a wall.

const POLL_MS = 5000;

// Values out of the database go through this before they reach the screen.
//
// plan_type holds 'individual' and 'business', kind holds 'plan_change' — all
// perfectly reasonable column values and none of them things to print. They
// were going out raw, so a wall display carried "plan change · business" in
// the middle of otherwise finished text.
function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ');
}

function useLive() {
  const [data, setData] = useState(null);
  const [failing, setFailing] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    async function tick() {
      try {
        const res = await api.get('/admin/live');
        if (!alive.current) return;
        setData(res.data);
        setFailing(false);
      } catch {
        // A screen on a wall must not clear itself because one poll failed.
        // The last known picture with a warning on it is more use than an error
        // page, so it keeps what it had and carries on asking.
        if (alive.current) setFailing(true);
      }
    }

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  return { data, failing };
}

const CARD = {
  borderRadius: 14,
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
};

const LABEL = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 1.1,
  textTransform: 'uppercase',
  color: 'rgba(226, 236, 250, 0.45)',
};

// One figure, and what it should be read against.
//
// The accent is spent on the number alone and only where it is worth noticing:
// money that has come in, somebody on the site, a queue with something in it.
// A tile that is always green is a tile nobody reads.
function Tile({ label, value, sub, tone }) {
  return (
    <div style={{ ...CARD, flex: '1 1 200px', minWidth: 0, padding: '16px 18px' }}>
      <div style={LABEL}>{label}</div>
      <div
        style={{
          marginTop: 8,
          fontSize: 'clamp(26px, 3.2vw, 40px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: -0.8,
          color: tone || '#f2f7ff',
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 5, fontSize: 12.5, lineHeight: 1.45, color: 'rgba(226, 236, 250, 0.5)' }}>{sub}</div>
      )}
    </div>
  );
}

function Card({ title, aside, children }) {
  return (
    <div style={{ ...CARD, flex: '1 1 320px', minWidth: 0, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span style={LABEL}>{title}</span>
        <span style={{ flex: 1 }} />
        {aside && <span style={{ fontSize: 12, color: 'rgba(226, 236, 250, 0.4)' }}>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

// Fourteen days, as bars.
//
// Scaled to the tallest day rather than to a round number, because the shape is
// the point and a fixed ceiling flattens a quiet fortnight into nothing. Today
// is drawn as an outline: a short last bar is a day still being filled in, not
// a fall, and without that distinction every morning reads as a collapse.
function Bars({ days, valueOf, colour, format }) {
  const top = Math.max(1, ...days.map(valueOf));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
        {days.map((d, i) => {
          const value = valueOf(d);
          const last = i === days.length - 1;
          return (
            <div
              key={d.day}
              title={`${new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} — ${format(value)}`}
              style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', height: '100%' }}
            >
              <div
                style={{
                  width: '100%',
                  height: `${Math.max(value ? 5 : 2, (value / top) * 100)}%`,
                  borderRadius: 3,
                  background: value ? colour : 'rgba(255, 255, 255, 0.07)',
                  border: last ? '1px solid rgba(255, 255, 255, 0.5)' : 'none',
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 7,
          fontSize: 11,
          color: 'rgba(226, 236, 250, 0.35)',
        }}
      >
        <span>14 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Row({ lead, detail, right, tone }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '7px 0',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        fontSize: 13.5,
      }}
    >
      <span style={{ fontWeight: 700, color: tone || '#f2f7ff', flexShrink: 0 }}>{lead}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          color: 'rgba(226, 236, 250, 0.55)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {detail}
      </span>
      <span style={{ fontSize: 12, color: 'rgba(226, 236, 250, 0.35)', flexShrink: 0 }}>{right}</span>
    </div>
  );
}

function when(value) {
  const then = new Date(value).getTime();
  if (!then) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ViewServer({ onClose }) {
  const { data, failing } = useLive();

  // Escape leaves. A full-screen page with one small control in a corner is a
  // page somebody gets stuck on.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const money = (cents, currency) => formatMoney((cents || 0) / 100, currency || 'AUD');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3200,
        overflowY: 'auto',
        padding: 'clamp(16px, 2.2vw, 32px)',
        background: 'radial-gradient(120% 80% at 50% 0%, #14294a 0%, #0b1626 55%, #070e1b 100%)',
        color: '#f2f7ff',
        // Digits that line up in a column, everywhere on the page at once.
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'clamp(14px, 2vw, 22px)' }}>
        <img src="/logo.svg" alt="" width="30" height="30" style={{ borderRadius: 6, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'clamp(15px, 1.7vw, 19px)', fontWeight: 700, letterSpacing: -0.3 }}>Taxify</div>
          <div style={{ ...LABEL, fontSize: 10.5 }}>Live</div>
        </div>

        <span style={{ flex: 1 }} />

        {/* A heartbeat. Without one, a display that has stopped polling looks
            exactly like a morning where nothing happened. */}
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(226, 236, 250, 0.5)' }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: failing ? '#f87171' : '#34d399',
              boxShadow: `0 0 10px ${failing ? '#f87171' : '#34d399'}`,
            }}
          />
          {failing ? 'Reconnecting' : data ? when(data.at) : 'Starting'}
        </span>

        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '8px 15px',
            borderRadius: 999,
            border: '1px solid rgba(255, 255, 255, 0.16)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#f2f7ff',
            font: 'inherit',
            fontSize: 13,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Close
        </button>
      </header>

      {!data ? (
        <div style={{ fontSize: 14, color: 'rgba(226, 236, 250, 0.5)' }}>Reading the server…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(10px, 1.4vw, 16px)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(10px, 1.4vw, 16px)' }}>
            <Tile
              label="On The Site"
              value={data.online}
              sub={`${data.activeToday} today`}
              tone={data.online > 0 ? '#34d399' : undefined}
            />
            <Tile label="Signed Up Today" value={data.signupsToday} sub={`${data.accounts.total} accounts`} />
            <Tile
              label="Taken Today"
              value={money(data.takings.todayCents)}
              sub={`${data.takings.todayCount} payment${data.takings.todayCount === 1 ? '' : 's'}`}
              tone={data.takings.todayCents > 0 ? '#34d399' : undefined}
            />
            <Tile
              label="This Month"
              value={money(data.takings.monthCents)}
              sub={`${data.accounts.subscribed} subscribed · ${data.accounts.trialing} on trial`}
            />
            <Tile
              label="Waiting On Us"
              value={data.support.unassigned}
              sub={`${data.support.open} open · ${data.support.mine} yours`}
              tone={data.support.unassigned > 0 ? '#fbbf24' : undefined}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(10px, 1.4vw, 16px)' }}>
            <Card title="Sign-ups" aside="14 days">
              <Bars
                days={data.days}
                valueOf={(d) => d.signups}
                colour="#7cb8ff"
                format={(v) => `${v} sign-up${v === 1 ? '' : 's'}`}
              />
            </Card>
            <Card title="Takings" aside="14 days">
              <Bars days={data.days} valueOf={(d) => d.cents} colour="#34d399" format={(v) => money(v)} />
            </Card>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(10px, 1.4vw, 16px)' }}>
            <Card title="Money In" aside={data.payments.length ? undefined : 'Nothing yet'}>
              {data.payments.map((p, i) => (
                <Row
                  key={i}
                  tone="#34d399"
                  lead={money(p.amountCents, p.currency)}
                  detail={[titleCase(p.kind), p.planType && titleCase(p.planType), p.country]
                    .filter(Boolean)
                    .join(' · ')}
                  right={when(p.at)}
                />
              ))}
            </Card>

            <Card title="New Accounts" aside={data.signups.length ? undefined : 'Nobody yet'}>
              {data.signups.map((u, i) => (
                <Row
                  key={i}
                  tone={u.activated ? undefined : '#fbbf24'}
                  lead={u.name || 'Unnamed'}
                  detail={[u.planType && titleCase(u.planType), u.country, u.activated ? null : 'Not activated']
                    .filter(Boolean)
                    .join(' · ')}
                  right={when(u.at)}
                />
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
