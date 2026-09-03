import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { SkeletonList } from './Skeletons.jsx';

// Traffic, for whoever is deciding where to spend the next hour.
//
// The page answers four questions in the order somebody actually asks them:
// is it going up, where are they coming from, what are they looking at, and
// did any of it turn into a press. Everything else is detail underneath.
//
// Two series colours and no more. The line carries views and visitors; every
// bar on the page is one hue, because a bar's length is the measurement and a
// second colour would be claiming to say something it does not. The pair was
// checked for colour-blind separation rather than chosen by eye — blue against
// amber is the widest gap available at this lightness, and it survives protan,
// deutan and tritan simulation.
const VIEWS = '#1559b8';
const VISITORS = '#b45309';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const SURFACES = [
  { key: 'all', label: 'Everything' },
  { key: 'landing', label: 'Landing page' },
  { key: 'app', label: 'The app' },
];

// What a channel is, in one word, beside its name.
//
// Carried as a word rather than as a colour. Six channels needs six hues, and
// six hues that a colour-blind reader can still tell apart do not exist at one
// lightness — the honest version of that constraint is to write it down.
const KIND_WORDS = {
  search: 'Search',
  social: 'Social',
  ai: 'Assistant',
  email: 'Email',
  direct: 'Direct',
  other: 'Referral',
  internal: 'Internal',
};

const COUNTRY_NAMES = {
  AU: 'Australia', NZ: 'New Zealand', GB: 'United Kingdom', US: 'United States',
  CA: 'Canada', IE: 'Ireland', SG: 'Singapore', IN: 'India', ZA: 'South Africa',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', PH: 'Philippines', ID: 'Indonesia',
};

const DEVICE_WORDS = {
  mobile: 'Phone', tablet: 'Tablet', desktop: 'Computer',
  'android-app': 'Android app', unknown: 'Unknown',
};

function tidyNumber(n) {
  return new Intl.NumberFormat().format(Number(n) || 0);
}

// A movement, or nothing at all.
//
// Growth from zero is not a percentage — ten visits after a week of none is
// not "1000% up", and printing that number would be inventing a precision the
// data does not have. Those say "new" instead.
function Movement({ now, before }) {
  const a = Number(now) || 0;
  const b = Number(before) || 0;
  if (b === 0) {
    if (a === 0) return null;
    return <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--emerald)' }}>New</span>;
  }
  const pct = Math.round(((a - b) / b) * 1000) / 10;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  return (
    <span
      title={`${tidyNumber(b)} in the period before`}
      style={{
        fontSize: 11.5,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        color: flat ? 'var(--text-muted)' : up ? 'var(--emerald)' : 'var(--red)',
      }}
    >
      {/* The arrow as well as the colour, so the direction survives a reader
          who cannot separate the two hues, a printout and a screenshot. */}
      {flat ? '—' : up ? '▲' : '▼'}
      {flat ? 'level' : `${Math.abs(pct)}%`}
    </span>
  );
}

function Tile({ label, value, now, before, hint }) {
  return (
    <div
      style={{
        flex: '1 1 150px',
        minWidth: 0,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '13px 15px',
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 0.7,
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        {before !== undefined && <Movement now={now} before={before} />}
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>
      )}
    </div>
  );
}

function Panel({ title, aside, children, wide = false }) {
  return (
    <section
      style={{
        flex: wide ? '1 1 100%' : '1 1 340px',
        minWidth: 0,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '15px 17px 17px',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 13 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>{title}</h3>
        <span style={{ flex: 1 }} />
        {aside && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{aside}</span>}
      </header>
      {children}
    </section>
  );
}

// Views and visitors over the range, as two lines.
//
// A line rather than bars because the question is the shape of a trend, and
// because two measures of the same thing over the same days belong on one pair
// of axes — never two scales, which is the way to make any two lines agree.
// Both are counts of the same kind, so one axis is honest.
function TrendChart({ series }) {
  const [hover, setHover] = useState(null);
  const boxRef = useRef(null);

  const W = 720;
  const H = 190;
  const PAD = { top: 12, right: 14, bottom: 22, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const top = Math.max(1, ...series.map((d) => Math.max(d.views, d.visitors)));
  // A round ceiling, so the gridlines land on numbers somebody would say out
  // loud rather than on 37 and 74.
  const step = Math.max(1, Math.ceil(top / 4 / 5) * 5);
  const ceiling = step * 4;

  const x = (i) => PAD.left + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (v / ceiling) * plotH;
  const path = (key) => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');

  function onMove(e) {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || !series.length) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / plotW) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  }

  const at = hover === null ? null : series[hover];

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={boxRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Views and visitors over the last ${series.length} days`}
      >
        {/* Recessive grid: there to be measured against, not to be looked at. */}
        {[0, 1, 2, 3, 4].map((n) => (
          <g key={n}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(step * n)}
              y2={y(step * n)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(step * n) + 3.5}
              textAnchor="end"
              style={{ fontSize: 10, fill: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}
            >
              {step * n}
            </text>
          </g>
        ))}

        {series.length > 1 && (
          <>
            {/* Views gets a faint fill under it as well as a line: it is the
                larger of the two by definition, and the fill is what stops the
                pair reading as two unrelated lines. */}
            <path
              d={`${path('views')} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
              fill={VIEWS}
              opacity="0.07"
            />
            <path d={path('views')} fill="none" stroke={VIEWS} strokeWidth="2" strokeLinejoin="round" />
            <path d={path('visitors')} fill="none" stroke={VISITORS} strokeWidth="2" strokeLinejoin="round" />
          </>
        )}

        {/* The endpoint, emphasised. Where the line has got to is the thing
            being read, and a dot there saves hunting along the edge. */}
        {series.length > 1 && (
          <>
            <circle cx={x(series.length - 1)} cy={y(series[series.length - 1].views)} r="4" fill={VIEWS} />
            <circle cx={x(series.length - 1)} cy={y(series[series.length - 1].visitors)} r="4" fill={VISITORS} />
          </>
        )}

        {at && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--border-strong)" strokeWidth="1" />
            {/* A ring of the surface colour around each marker, so a point
                sitting on the other line still reads as two points. */}
            <circle cx={x(hover)} cy={y(at.views)} r="5" fill={VIEWS} stroke="var(--bg-card)" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(at.visitors)} r="5" fill={VISITORS} stroke="var(--bg-card)" strokeWidth="2" />
          </g>
        )}

        <text x={PAD.left} y={H - 6} style={{ fontSize: 10, fill: 'var(--text-subtle)' }}>
          {series[0] ? new Date(series[0].day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" style={{ fontSize: 10, fill: 'var(--text-subtle)' }}>
          Today
        </text>
      </svg>

      {at && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > series.length / 2 ? '-105%' : '5%'})`,
            pointerEvents: 'none',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 9,
            padding: '7px 10px',
            fontSize: 11.5,
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 3 }}>
            {new Date(at.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: VIEWS }} />
            {tidyNumber(at.views)} views
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: VISITORS }} />
            {tidyNumber(at.visitors)} visitors
          </div>
        </div>
      )}

      {/* Always present, because there are two series and colour alone must
          never be the only thing saying which is which. */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
        {[
          { c: VIEWS, t: 'Views' },
          { c: VISITORS, t: 'Visitors' },
        ].map((s) => (
          <span key={s.t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 3, borderRadius: 2, background: s.c }} />
            {s.t}
          </span>
        ))}
      </div>
    </div>
  );
}

// A ranked list where the bar is the number.
//
// One hue throughout: length carries the magnitude, and giving each row its
// own colour would be encoding rank as identity — which then changes every
// time the filter changes and the order moves.
function BarList({ rows, empty }) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) {
    return <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', padding: '6px 0' }}>{empty}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.map((r) => (
        <div key={r.key} title={r.title || undefined}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                fontSize: 12.5,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.label}
            </span>
            {r.tag && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: 'var(--text-subtle)',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '1px 7px',
                  flexShrink: 0,
                }}
              >
                {r.tag}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {tidyNumber(r.value)}
            </span>
            {r.secondary !== undefined && (
              <span
                style={{ fontSize: 11, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
              >
                {tidyNumber(r.secondary)}
              </span>
            )}
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-inset)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(2, (r.value / top) * 100)}%`,
                height: '100%',
                borderRadius: 3,
                background: VIEWS,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Twenty-four columns, one per hour. A shape rather than a number: the useful
// reading is "evenings" or "during business hours", not that 14:00 had eleven.
function HoursChart({ hours }) {
  const top = Math.max(1, ...hours.map((h) => h.views));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 76 }}>
        {hours.map((h) => (
          <div
            key={h.hour}
            title={`${String(h.hour).padStart(2, '0')}:00 — ${tidyNumber(h.views)} view${h.views === 1 ? '' : 's'}`}
            style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end' }}
          >
            <div
              style={{
                width: '100%',
                height: `${Math.max(h.views ? 4 : 2, (h.views / top) * 100)}%`,
                borderRadius: '4px 4px 0 0',
                background: h.views ? VIEWS : 'var(--bg-inset)',
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          fontSize: 10.5,
          color: 'var(--text-subtle)',
        }}
      >
        <span>12am</span>
        <span>6am</span>
        <span>Midday</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
    </div>
  );
}

export default function AnalyticsTab() {
  const [days, setDays] = useState(30);
  const [surface, setSurface] = useState('all');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    api
      .get(`/admin/analytics?days=${days}&surface=${surface}`)
      .then((res) => alive && setData(res.data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [days, surface]);

  const sources = useMemo(
    () =>
      (data?.sources || []).map((s) => ({
        key: `${s.kind}:${s.name}`,
        label: s.name,
        tag: KIND_WORDS[s.kind] || s.kind,
        value: s.views,
        secondary: s.visitors,
        title: `${tidyNumber(s.views)} views from ${tidyNumber(s.visitors)} visitors`,
      })),
    [data]
  );

  if (failed) {
    return (
      <div className="card" style={{ padding: 18, fontSize: 13, color: 'var(--text-muted)' }}>
        Could not read the traffic figures. The page is fine — try again in a moment.
      </div>
    );
  }
  if (!data) return <SkeletonList rows={4} />;

  const t = data.totals;
  const p = data.previous;

  // How much of the country panel is measured and how much is inferred.
  //
  // Three sources of very different confidence land in one column, so the
  // panel says which. Without this the map reads as fact when most of it may
  // be a browser's language setting.
  const src = data.countrySources || {};
  const placed = (src.header || 0) + (src.account || 0) + (src.locale || 0);
  const countryConfidence =
    placed === 0
      ? undefined
      : src.locale === placed
      ? 'From browser settings'
      : src.locale
      ? `${Math.round((src.locale / placed) * 100)}% from browser settings`
      : 'Measured';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Both filters on one row above everything, because both change every
          panel below and a control that reaches the whole page belongs at the
          top of it. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={days === r.days ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ fontSize: 12.5, padding: '6px 13px' }}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {SURFACES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={surface === s.key ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ fontSize: 12.5, padding: '6px 13px' }}
              onClick={() => setSurface(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Tile label="Views" value={tidyNumber(t.views)} now={t.views} before={p.views} />
        <Tile label="Visitors" value={tidyNumber(t.visitors)} now={t.visitors} before={p.visitors} />
        <Tile
          label="First time"
          value={tidyNumber(t.newVisitors)}
          now={t.newVisitors}
          before={p.newVisitors}
          hint="Never seen before"
        />
        <Tile label="Came back" value={tidyNumber(t.repeatVisitors)} hint="On more than one day" />
        <Tile label="Presses" value={tidyNumber(t.clicks)} now={t.clicks} before={p.clicks} hint="Buttons and links" />
      </div>

      <Panel title="Views and visitors" aside={`Last ${data.days} days`} wide>
        <TrendChart series={data.series} />
      </Panel>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <Panel title="Where they came from" aside="views · visitors">
          <BarList rows={sources} empty="Nothing recorded yet." />
        </Panel>

        <Panel title="What they looked at" aside="views · visitors">
          <BarList
            rows={(data.pages || []).map((r) => ({
              key: r.path,
              label: r.path,
              value: r.views,
              secondary: r.visitors,
            }))}
            empty="Nothing recorded yet."
          />
        </Panel>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <Panel title="What they pressed">
          <BarList
            rows={(data.clicks || []).map((r) => ({
              key: `${r.event}:${r.label || ''}`,
              label: r.label || r.event,
              tag: r.label ? r.event.replace(/_/g, ' ') : null,
              value: r.count,
              secondary: r.visitors,
            }))}
            empty="No presses recorded yet."
          />
        </Panel>

        <Panel title="Countries" aside={countryConfidence}>
          <BarList
            rows={(data.countries || []).map((r) => ({
              key: r.code || 'unknown',
              label: r.code ? COUNTRY_NAMES[r.code] || r.code : 'Unknown',
              value: r.views,
              secondary: r.visitors,
              title: r.code
                ? undefined
                : 'Nothing on this visit said where it came from — no network country, no account, no regional setting',
            }))}
            empty="Nothing recorded yet."
          />
        </Panel>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <Panel title="What they read it on">
          <BarList
            rows={(data.devices || []).map((r) => ({
              key: r.device || 'unknown',
              label: DEVICE_WORDS[r.device] || r.device || 'Unknown',
              value: r.views,
            }))}
            empty="Nothing recorded yet."
          />
        </Panel>

        <Panel title="Time of day" aside="Server time">
          <HoursChart hours={data.hours || []} />
        </Panel>
      </div>

      {data.campaigns?.length > 0 && (
        <Panel title="Campaigns" aside="From utm tags and click ids" wide>
          <BarList
            rows={data.campaigns.map((c) => ({
              key: `${c.source}:${c.medium}:${c.campaign}`,
              label: [c.campaign, c.source].filter(Boolean).join(' · ') || c.source,
              tag: c.medium || null,
              value: c.views,
              secondary: c.visitors,
            }))}
            empty=""
          />
        </Panel>
      )}

      {/* What the numbers cannot tell you, said once, at the bottom.

          Every one of these is a real limit of how the figures are collected,
          and a dashboard that does not admit its own blind spots is one that
          gets trusted further than it deserves. */}
      <div
        style={{
          display: 'flex',
          gap: 11,
          alignItems: 'flex-start',
          padding: '13px 15px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}
      >
        <span style={{ color: 'var(--text-subtle)', marginTop: 1, flexShrink: 0 }}>
          <Icon name="info" size={15} />
        </span>
        <div>
          Crawlers and link previews are dropped before anything is recorded, so these are people rather than robots.
          Visitors are counted with a cookie of ours: read through the hub&rsquo;s copy of the landing page that cookie
          is third-party and most browsers refuse it, so those visits count as first-time every time and the real
          number of people is a little lower than it looks. Countries are taken from the network where the server in
          front of us supplies one, otherwise from the signed-in account, otherwise from the region in the
          browser&rsquo;s language setting — which is a fair guess and not a measurement, so the panel says how much of
          it is which. For the real thing, nginx needs its GeoIP module. Rows older than a year are deleted.
        </div>
      </div>
    </div>
  );
}
