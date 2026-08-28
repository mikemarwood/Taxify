import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import Icon from './Icon.jsx';

// The wall display.
//
// Meant to be cast to a television or left full-screen on a spare monitor, so
// it is read from across a room rather than from a desk: very large numbers,
// very few of them, and enough contrast to survive a bright office. Everything
// that would be useful up close and useless at four metres — filters, tables,
// anything needing a pointer — is deliberately not here.
//
// No customer names anywhere on it. A screen anybody walking past can read is
// not the place for who paid what; the amount, the plan and the country say
// how the business is doing without putting a person on a wall.

const POLL_MS = 5000;

function useLive() {
  const [data, setData] = useState(null);
  const [failing, setFailing] = useState(false);
  // Kept in a ref so the interval closure never captures a stale one.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer = null;

    async function tick() {
      try {
        const res = await api.get('/admin/live');
        if (!alive.current) return;
        setData(res.data);
        setFailing(false);
      } catch {
        // A screen on a wall must not clear itself because one poll failed —
        // the last known picture with a warning on it is far more use than an
        // error page. It carries on asking.
        if (alive.current) setFailing(true);
      }
    }

    tick();
    timer = setInterval(tick, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  return { data, failing };
}

function Big({ label, value, sub, tone }) {
  return (
    <div
      style={{
        flex: '1 1 220px',
        minWidth: 0,
        padding: '22px 24px',
        borderRadius: 18,
        background: 'rgba(255,255,255,.045)',
        border: '1px solid rgba(255,255,255,.10)',
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(234,241,251,.55)' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 'clamp(38px, 6vw, 76px)',
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: -1.5,
          marginTop: 6,
          color: tone || '#fff',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 13.5, color: 'rgba(234,241,251,.6)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Feed({ title, icon, rows, empty }) {
  return (
    <div
      style={{
        flex: '1 1 340px',
        minWidth: 0,
        padding: '18px 20px',
        borderRadius: 18,
        background: 'rgba(255,255,255,.045)',
        border: '1px solid rgba(255,255,255,.10)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon name={icon} size={16} style={{ color: '#8fc0ff' }} />
        <span style={{ fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(234,241,251,.55)' }}>
          {title}
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 15, color: 'rgba(234,241,251,.45)' }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{rows}</div>
      )}
    </div>
  );
}

function when(value) {
  const then = new Date(value).getTime();
  if (!then) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ViewServer({ onClose }) {
  const { data, failing } = useLive();

  // Escape leaves, because a full-screen page with one small button in the
  // corner is a page somebody gets stuck on.
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
        padding: 'clamp(18px, 3vw, 40px)',
        background: 'linear-gradient(180deg, #0b1a30 0%, #0a1526 55%, #070f1e 100%)',
        color: '#eaf1fb',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'clamp(16px, 2.5vw, 28px)' }}>
        <img src="/logo.svg" alt="" width="34" height="34" style={{ borderRadius: 7 }} />
        <span style={{ fontSize: 'clamp(18px, 2.4vw, 26px)', fontWeight: 800, letterSpacing: -0.5 }}>
          Taxify — live
        </span>

        {/* A heartbeat, so a frozen screen is distinguishable from a quiet one.
            Without it a wall display that stopped polling looks exactly like a
            morning where nothing happened. */}
        <span
          title={failing ? 'Cannot reach the server' : 'Updating'}
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: failing ? '#f87171' : '#34d399',
            boxShadow: `0 0 12px ${failing ? '#f87171' : '#34d399'}`,
          }}
        />
        <span style={{ fontSize: 13, color: 'rgba(234,241,251,.55)' }}>
          {failing ? 'Reconnecting…' : data ? `updated ${when(data.at)}` : 'starting…'}
        </span>

        <span style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '9px 16px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,.2)',
            background: 'rgba(255,255,255,.08)',
            color: '#fff',
            font: 'inherit',
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {!data ? (
        <div style={{ fontSize: 16, color: 'rgba(234,241,251,.6)' }}>Reading the server…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(14px, 2vw, 22px)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(12px, 1.6vw, 18px)' }}>
            <Big
              label="On the site now"
              value={data.online}
              sub={`${data.activeToday} today`}
              tone={data.online > 0 ? '#34d399' : undefined}
            />
            <Big label="Signed up today" value={data.signupsToday} sub={`${data.accounts.total} accounts`} />
            <Big
              label="Taken today"
              value={money(data.takings.todayCents)}
              sub={`${data.takings.todayCount} payment${data.takings.todayCount === 1 ? '' : 's'}`}
              tone={data.takings.todayCents > 0 ? '#34d399' : undefined}
            />
            <Big
              label="This month"
              value={money(data.takings.monthCents)}
              sub={`${data.accounts.subscribed} subscribed · ${data.accounts.trialing} on trial`}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(12px, 1.6vw, 18px)' }}>
            <Feed
              title="Money in"
              icon="credit-card"
              empty="Nothing yet."
              rows={data.payments.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 16 }}>
                  <strong style={{ color: '#34d399', fontVariantNumeric: 'tabular-nums', minWidth: 92 }}>
                    {money(p.amountCents, p.currency)}
                  </strong>
                  <span style={{ color: 'rgba(234,241,251,.75)', flex: 1, minWidth: 0 }}>
                    {p.kind === 'plan_change' ? 'plan change' : 'subscription'}
                    {p.planType ? ` · ${p.planType}` : ''}
                    {p.country ? ` · ${p.country}` : ''}
                  </span>
                  <span style={{ color: 'rgba(234,241,251,.45)', fontSize: 13 }}>{when(p.at)}</span>
                </div>
              ))}
            />

            <Feed
              title="New accounts"
              icon="user"
              empty="Nobody yet today."
              rows={data.signups.map((u, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 16 }}>
                  <span style={{ color: 'rgba(234,241,251,.75)', flex: 1, minWidth: 0 }}>
                    {u.planType || 'no plan yet'}
                    {u.country ? ` · ${u.country}` : ''}
                    {!u.activated && <span style={{ color: '#fbbf24' }}> · not activated</span>}
                  </span>
                  <span style={{ color: 'rgba(234,241,251,.45)', fontSize: 13 }}>{when(u.at)}</span>
                </div>
              ))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
