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
// Every ticket on this list is one waiting on us — newly raised, or answered by
// the customer and back in our court. The server filters to that, so the amber
// is the whole story and a per-row status label would say the same thing eight
// times.
const NEEDS_REPLY = '#fbbf24';

// A live answer to a media query.
//
// Written as a hook rather than read once at module load, because the whole
// point here is orientation, which changes in somebody's hand while the page
// is open.
function useMedia(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

// A phone or a small tablet. Not "is touch", because a Surface with a
// touchscreen has a full-width screen and reads this fine.
const SMALL = '(max-width: 900px)';
const PORTRAIT = '(orientation: portrait)';

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
function Tile({ label, value, sub, tone, compact = false }) {
  return (
    <div
      style={{
        ...CARD,
        // Two to a row on a phone rather than one, which is what a 200px basis
        // gives on a 390px screen: five full-width slabs, each mostly empty,
        // and the charts pushed off the bottom.
        flex: compact ? '1 1 132px' : '1 1 200px',
        minWidth: 0,
        padding: compact ? '11px 12px' : '16px 18px',
      }}
    >
      <div style={{ ...LABEL, fontSize: compact ? 9.5 : 11, letterSpacing: compact ? 0.7 : 1.1 }}>{label}</div>
      <div
        style={{
          marginTop: compact ? 5 : 8,
          fontSize: compact ? 'clamp(19px, 5.4vw, 26px)' : 'clamp(26px, 3.2vw, 40px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: -0.8,
          color: tone || '#f2f7ff',
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            marginTop: compact ? 3 : 5,
            fontSize: compact ? 11 : 12.5,
            lineHeight: 1.4,
            color: 'rgba(226, 236, 250, 0.5)',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function Card({ title, aside, children, compact = false }) {
  return (
    <div
      style={{
        ...CARD,
        flex: compact ? '1 1 260px' : '1 1 320px',
        minWidth: 0,
        padding: compact ? '12px 13px' : '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: compact ? 9 : 12 }}>
        <span style={{ ...LABEL, fontSize: compact ? 9.5 : 11, letterSpacing: compact ? 0.7 : 1.1 }}>{title}</span>
        <span style={{ flex: 1 }} />
        {aside && (
          <span style={{ fontSize: compact ? 10.5 : 12, color: 'rgba(226, 236, 250, 0.4)' }}>{aside}</span>
        )}
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
function Bars({ days, valueOf, colour, format, compact = false }) {
  const top = Math.max(1, ...days.map(valueOf));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: compact ? 2 : 3, height: compact ? 44 : 64 }}>
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

function Row({ lead, detail, right, tone, compact = false }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: compact ? 7 : 10,
        padding: compact ? '5px 0' : '7px 0',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        fontSize: compact ? 12 : 13.5,
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
      <span style={{ fontSize: compact ? 11 : 12, color: 'rgba(226, 236, 250, 0.35)', flexShrink: 0 }}>{right}</span>
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
  const small = useMedia(SMALL);
  const portrait = useMedia(PORTRAIT);

  // Escape leaves. A full-screen page with one small control in a corner is a
  // page somebody gets stuck on.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Ask the phone to turn.
  //
  // A locked orientation is only granted inside full screen, and only by
  // Android — iOS refuses both, and a desktop browser has nothing to lock. So
  // this is an attempt, not a mechanism: every call is wrapped, nothing is
  // reported when it fails, and the panel below is what actually gets the
  // phone turned around. Full screen is worth asking for on its own anyway,
  // since this display is all there is to look at.
  useEffect(() => {
    if (!small) return undefined;
    let locked = false;
    (async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
        await window.screen?.orientation?.lock?.('landscape');
        locked = true;
      } catch {
        // Refused, which is the common case. The rotate panel covers it.
      }
    })();
    return () => {
      try {
        if (locked) window.screen?.orientation?.unlock?.();
        if (document.fullscreenElement) document.exitFullscreen?.();
      } catch {
        // Leaving is not worth an error either.
      }
    };
  }, [small]);

  const compact = small;
  const money = (cents, currency) => formatMoney((cents || 0) / 100, currency || 'AUD');

  // Held sideways, or not shown at all.
  //
  // This is a wall display: fourteen columns of chart, five figures across and
  // three feeds. Squeezed into a portrait phone it becomes a very long ribbon
  // that has to be scrolled to be read, which is the opposite of a screen you
  // glance at. Turning the phone gives it the shape it was drawn for, and
  // saying so plainly beats rendering something unusable and hoping.
  if (small && portrait) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 3200,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          padding: 28,
          textAlign: 'center',
          background: 'radial-gradient(120% 80% at 50% 0%, #14294a 0%, #0b1626 55%, #070e1b 100%)',
          color: '#f2f7ff',
        }}
      >
        <img src="/logo.svg" alt="" width="40" height="40" style={{ borderRadius: 9 }} />
        <div className="viewserver-turn" aria-hidden="true" />
        <style>{`
          .viewserver-turn {
            width: 62px;
            height: 104px;
            border-radius: 12px;
            border: 2px solid rgba(226, 236, 250, 0.55);
            animation: viewserver-turn 2.4s ease-in-out infinite;
          }
          @keyframes viewserver-turn {
            0%, 30% { transform: rotate(0deg); }
            55%, 85% { transform: rotate(-90deg); }
            100% { transform: rotate(0deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .viewserver-turn { animation: none; transform: rotate(-90deg); }
          }
        `}</style>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3, marginBottom: 6 }}>Turn your phone</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'rgba(226, 236, 250, 0.6)', maxWidth: 280 }}>
            The live display is built wide. Hold the phone sideways to see it.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '9px 18px',
            borderRadius: 999,
            border: '1px solid rgba(255, 255, 255, 0.16)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#f2f7ff',
            font: 'inherit',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3200,
        overflowY: 'auto',
        padding: compact ? 12 : 'clamp(16px, 2.2vw, 32px)',
        background: 'radial-gradient(120% 80% at 50% 0%, #14294a 0%, #0b1626 55%, #070e1b 100%)',
        color: '#f2f7ff',
        // Digits that line up in a column, everywhere on the page at once.
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 9 : 12,
          marginBottom: compact ? 10 : 'clamp(14px, 2vw, 22px)',
        }}
      >
        <img
          src="/logo.svg"
          alt=""
          width={compact ? 22 : 30}
          height={compact ? 22 : 30}
          style={{ borderRadius: 6, flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: compact ? 14 : 'clamp(15px, 1.7vw, 19px)',
              fontWeight: 700,
              letterSpacing: -0.3,
            }}
          >
            Taxify
          </div>
          <div style={{ ...LABEL, fontSize: compact ? 9 : 10.5 }}>Live</div>
        </div>

        <span style={{ flex: 1 }} />

        {/* A heartbeat. Without one, a display that has stopped polling looks
            exactly like a morning where nothing happened. */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: compact ? 11 : 12,
            color: 'rgba(226, 236, 250, 0.5)',
          }}
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
            padding: compact ? '6px 12px' : '8px 15px',
            borderRadius: 999,
            border: '1px solid rgba(255, 255, 255, 0.16)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#f2f7ff',
            font: 'inherit',
            fontSize: compact ? 12 : 13,
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 'clamp(10px, 1.4vw, 16px)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 8 : 'clamp(10px, 1.4vw, 16px)' }}>
            <Tile
              compact={compact}
              label="On The Site"
              value={data.online}
              sub={`${data.activeToday} today`}
              tone={data.online > 0 ? '#34d399' : undefined}
            />
            <Tile
              compact={compact}
              label="Signed Up Today"
              value={data.signupsToday}
              sub={`${data.accounts.total} accounts`}
            />
            <Tile
              compact={compact}
              label="Taken Today"
              value={money(data.takings.todayCents)}
              sub={`${data.takings.todayCount} payment${data.takings.todayCount === 1 ? '' : 's'}`}
              tone={data.takings.todayCents > 0 ? '#34d399' : undefined}
            />
            <Tile
              compact={compact}
              label="This Month"
              value={money(data.takings.monthCents)}
              sub={`${data.accounts.subscribed} subscribed · ${data.accounts.trialing} on trial`}
            />
            <Tile
              compact={compact}
              label="Waiting On Us"
              value={data.support.unassigned}
              sub={`${data.support.open} open · ${data.support.mine} yours`}
              tone={data.support.unassigned > 0 ? '#fbbf24' : undefined}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 8 : 'clamp(10px, 1.4vw, 16px)' }}>
            <Card compact={compact} title="Sign-ups" aside="14 days">
              <Bars
                compact={compact}
                days={data.days}
                valueOf={(d) => d.signups}
                colour="#7cb8ff"
                format={(v) => `${v} sign-up${v === 1 ? '' : 's'}`}
              />
            </Card>
            <Card compact={compact} title="Takings" aside="14 days">
              <Bars compact={compact} days={data.days} valueOf={(d) => d.cents} colour="#34d399" format={(v) => money(v)} />
            </Card>
          </div>

          <Card
            compact={compact}
            title="Support"
            aside={
              data.support.tickets.length
                ? `${data.support.awaiting} waiting · ${data.support.unassigned} unassigned`
                : 'Nothing waiting'
            }
          >
            {data.support.tickets.map((t) => (
              <Row
                compact={compact}
                key={t.reference}
                tone={NEEDS_REPLY}
                lead={t.reference}
                detail={[titleCase(t.category), t.assigned ? null : 'Unassigned'].filter(Boolean).join(' · ')}
                right={when(t.at)}
              />
            ))}
          </Card>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 8 : 'clamp(10px, 1.4vw, 16px)' }}>
            <Card compact={compact} title="Money In" aside={data.payments.length ? undefined : 'Nothing yet'}>
              {data.payments.map((p, i) => (
                <Row
                compact={compact}
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

            <Card compact={compact} title="New Accounts" aside={data.signups.length ? undefined : 'Nobody yet'}>
              {data.signups.map((u, i) => (
                <Row
                compact={compact}
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
