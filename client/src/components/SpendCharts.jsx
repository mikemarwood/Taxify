import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { formatMoney, claimable } from '../lib/money.js';
import { formatDateLong } from '../lib/dates.js';

// Two charts and a countdown, all reading from the same filtered expense list.
//
// Form was chosen before colour. Monthly spending is change-over-time in
// discrete buckets, so it's columns. Category spending is magnitude with
// identity and needs exact comparison, so it's ranked horizontal bars — not a
// pie, which can't answer "is Tooling bigger than Training?" at a glance.
// Days-to-year-end is a single number, so it's a stat with a meter, not a
// chart at all.

const AU_FY_MONTHS = [
  { label: 'Jul', month: 6 },
  { label: 'Aug', month: 7 },
  { label: 'Sep', month: 8 },
  { label: 'Oct', month: 9 },
  { label: 'Nov', month: 10 },
  { label: 'Dec', month: 11 },
  { label: 'Jan', month: 0 },
  { label: 'Feb', month: 1 },
  { label: 'Mar', month: 2 },
  { label: 'Apr', month: 3 },
  { label: 'May', month: 4 },
  { label: 'Jun', month: 5 },
];

function niceCeiling(value) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    if (value <= magnitude * s) return magnitude * s;
  }
  return magnitude * 10;
}

function Panel({ title, subtitle, children, action }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2>
        {action}
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>{subtitle}</p>
      {children}
    </div>
  );
}

// --- Days to the end of the financial year -------------------------------

export function FinancialYearCountdown({ financialYear }) {
  const { daysLeft, elapsed, endLabel } = useMemo(() => {
    const startYear = Number(String(financialYear || '').slice(0, 4)) || new Date().getFullYear();
    const start = new Date(Date.UTC(startYear, 6, 1));
    const end = new Date(Date.UTC(startYear + 1, 5, 30));
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;

    const total = Math.round((end - start) / day);
    const gone = Math.round((now - start) / day);
    return {
      daysLeft: Math.max(0, Math.round((end - now) / day)),
      elapsed: Math.min(100, Math.max(0, (gone / total) * 100)),
      endLabel: formatDateLong(end),
    };
  }, [financialYear]);

  const past = daysLeft === 0;

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {past ? 'Financial year closed' : 'Days to end of financial year'}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
          {past ? '—' : daysLeft}
        </span>
        {!past && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{daysLeft === 1 ? 'day' : 'days'}</span>}
      </div>

      {/* A meter, not a chart: it shows how far through the year you are, which
          is the context the number needs. */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(elapsed)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Financial year elapsed"
        style={{ height: 6, borderRadius: 999, background: 'var(--bg-inset)', overflow: 'hidden' }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${elapsed}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{ height: '100%', borderRadius: 999, background: 'var(--accent)' }}
        />
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        FY {financialYear} ends {endLabel}
      </div>
    </div>
  );
}

// --- Spending by month ---------------------------------------------------

export function MonthlySpendChart({ expenses, financialYear }) {
  const [hover, setHover] = useState(null);

  const months = useMemo(() => {
    const startYear = Number(String(financialYear || '').slice(0, 4)) || new Date().getFullYear();
    const totals = AU_FY_MONTHS.map((m, i) => {
      const calendarYear = i < 6 ? startYear : startYear + 1;
      const total = expenses
        .filter((e) => {
          const d = new Date(e.purchaseDate);
          return d.getMonth() === m.month && d.getFullYear() === calendarYear;
        })
        .reduce((sum, e) => sum + claimable(e), 0);
      return { ...m, calendarYear, total };
    });
    return totals;
  }, [expenses, financialYear]);

  const max = Math.max(...months.map((m) => m.total), 0);
  const ceiling = niceCeiling(max);
  const busiest = months.reduce((best, m) => (m.total > best.total ? m : best), months[0]);
  const anySpend = max > 0;

  return (
    <Panel title="Spending by month" subtitle={`Every expense in FY ${financialYear}, month by month.`}>
      {!anySpend ? (
        <Empty>Nothing recorded in this financial year yet.</Empty>
      ) : (
        <>
          <div style={{ position: 'relative', height: 168, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {/* Hairline gridlines, solid and one step off the surface. */}
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <div
                key={f}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: `${f * 100}%`,
                  height: 1,
                  background: 'var(--border)',
                }}
              />
            ))}

            {months.map((m) => {
              const pct = ceiling ? (m.total / ceiling) * 100 : 0;
              const isBusiest = anySpend && m.label === busiest.label && m.total > 0;
              return (
                <div
                  key={m.label}
                  onMouseEnter={() => setHover(m)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(m)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  // The hit target is the whole column slot, not the bar — a
                  // 3px-tall bar is impossible to hover otherwise.
                  style={{
                    flex: 1,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    position: 'relative',
                    cursor: 'default',
                    outline: 'none',
                  }}
                >
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${pct}%` }}
                    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.02 }}
                    style={{
                      width: '100%',
                      maxWidth: 24,
                      minHeight: m.total > 0 ? 3 : 0,
                      // Rounded at the data end, square on the baseline.
                      borderRadius: '4px 4px 0 0',
                      background: 'var(--accent)',
                      opacity: hover && hover.label !== m.label ? 0.45 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  />

                  {/* Labelled selectively: the busiest month only. */}
                  {isBusiest && !hover && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: `calc(${pct}% + 5px)`,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatMoney(m.total)}
                    </span>
                  )}

                  {hover?.label === m.label && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: `calc(${pct}% + 6px)`,
                        padding: '5px 9px',
                        borderRadius: 6,
                        background: 'var(--nav-bg)',
                        color: '#fff',
                        fontSize: 11.5,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        zIndex: 2,
                        boxShadow: 'var(--shadow-raised)',
                      }}
                    >
                      <strong>{m.label} {m.calendarYear}</strong> · {formatMoney(m.total)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
            {months.map((m) => (
              <span
                key={m.label}
                style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: 'var(--text-muted)' }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
            Busiest month: <strong style={{ color: 'var(--text)' }}>{busiest.label}</strong> at{' '}
            {formatMoney(busiest.total)} · scale to {formatMoney(ceiling)}
          </div>
        </>
      )}
    </Panel>
  );
}

// --- Spending by category ------------------------------------------------

const MAX_SLICES = 8;

export function CategorySpendChart({ byCategory, onSelect }) {
  const [hover, setHover] = useState(null);

  // Past about eight classes adjacent colours blur, so the tail folds into a
  // single "Other" row rather than inventing more hues.
  const rows = useMemo(() => {
    if (byCategory.length <= MAX_SLICES) return byCategory;
    const head = byCategory.slice(0, MAX_SLICES - 1);
    const tail = byCategory.slice(MAX_SLICES - 1);
    return [
      ...head,
      {
        name: `Other (${tail.length} categories)`,
        color: 'var(--text-subtle)',
        total: tail.reduce((s, c) => s + c.total, 0),
        count: tail.reduce((s, c) => s + c.count, 0),
        isOther: true,
      },
    ];
  }, [byCategory]);

  const max = Math.max(...rows.map((r) => r.total), 0);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <Panel title="Where it went" subtitle="Categories ranked by spend — biggest first.">
      {rows.length === 0 ? (
        <Empty>No categories with spending yet.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row, i) => {
            const pct = max ? (row.total / max) * 100 : 0;
            const share = grandTotal ? Math.round((row.total / grandTotal) * 100) : 0;
            return (
              <div
                key={row.name}
                onMouseEnter={() => setHover(row.name)}
                onMouseLeave={() => setHover(null)}
                onClick={() => !row.isOther && onSelect?.(row.name)}
                style={{ cursor: row.isOther || !onSelect ? 'default' : 'pointer', minWidth: 0 }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  {/* Identity is never colour alone: every bar is named, which
                      matters here because the swatches are user-chosen and not
                      guaranteed to separate for colourblind readers. */}
                  <span
                    aria-hidden="true"
                    style={{ width: 9, height: 9, borderRadius: 3, background: row.color, flexShrink: 0 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12.5,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.name}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {share}%
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(row.total)}
                  </span>
                </div>

                <div style={{ height: 8, borderRadius: 999, background: 'var(--bg-inset)', overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
                    style={{
                      height: '100%',
                      borderRadius: 999,
                      background: row.color,
                      opacity: hover && hover !== row.name ? 0.5 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  />
                </div>

                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                  {row.count} {row.count === 1 ? 'entry' : 'entries'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Empty({ children }) {
  return (
    <div
      style={{
        padding: '28px 0',
        textAlign: 'center',
        fontSize: 13,
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </div>
  );
}
