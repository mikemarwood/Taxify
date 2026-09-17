import { useMemo } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import { formatMoney } from '../lib/money.js';

// The two pictures at the top of Reports: the same figures as the table
// underneath, read two different ways. The bars answer "which category, and is
// it going up or down"; the ring answers "what is the shape of the whole".
//
// Both are drawn here rather than pulled from a charting library. What they
// have to do is small and fixed, and a library would arrive with its own
// colours, its own fonts and its own idea of a tooltip, none of which match the
// rest of this app.

// One hue per financial year, oldest first, so a colour means the same thing in
// the bars and in the legend above them. Deliberately not the category colours:
// those are the other axis, and reusing them would say the two were related.
const YEAR_COLOURS = ['#8b5cf6', '#2f8bf4', '#10b981', '#f59e0b', '#ec4899', '#14b8a6'];

export function yearColour(index) {
  return YEAR_COLOURS[index % YEAR_COLOURS.length];
}

// A round number at or above the tallest bar, so the top gridline is a figure
// somebody recognises rather than the exact maximum.
function niceCeiling(value) {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function axisLabel(value) {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

// --- Category by year, as grouped bars ------------------------------------

export function CategoryYearChart({ categories, years, cellTotals }) {
  // Six at most. Past that the bars are too narrow to compare, which is the
  // only thing this chart is for — and the table below has every one of them.
  const shown = categories.slice(0, 6);

  const { ceiling, ticks } = useMemo(() => {
    let max = 0;
    for (const c of shown) {
      for (const y of years) max = Math.max(max, cellTotals.get(`${c.name}|${y}`) || 0);
    }
    const top = niceCeiling(max);
    return { ceiling: top, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => top * f) };
  }, [shown, years, cellTotals]);

  if (shown.length === 0 || years.length === 0) return null;

  return (
    <div className="card report-chart">
      <div className="panel-head">
        <span className="panel-head-mark">
          <Icon name="chart" size={17} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{years.length > 1 ? 'Spending by category across tax years' : 'Spending by category'}</h2>
          <p>
            {shown.length < categories.length
              ? `The ${shown.length} biggest categories, side by side.`
              : 'Every category, side by side.'}
          </p>
        </div>
        <div className="chart-legend" hidden={years.length < 2}>
          {years.map((y, i) => (
            <span key={y}>
              <i style={{ background: yearColour(i) }} />
              FY {y}
            </span>
          ))}
        </div>
      </div>

      <div className="chart-body">
        <div className="chart-axis">
          {[...ticks].reverse().map((t) => (
            <span key={t}>{axisLabel(t)}</span>
          ))}
        </div>

        <div className="chart-plot">
          {/* Gridlines behind the bars, at the figures the axis names. */}
          <div className="chart-grid" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} />
            ))}
          </div>

          <div className="chart-groups">
            {shown.map((c) => (
              <div className="chart-group" key={c.name}>
                <div className="chart-bars">
                  {years.map((y, i) => {
                    const value = cellTotals.get(`${c.name}|${y}`) || 0;
                    const height = ceiling ? (value / ceiling) * 100 : 0;
                    return (
                      <motion.span
                        key={y}
                        className="chart-bar"
                        style={{ background: yearColour(i) }}
                        initial={{ height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                        title={`${c.name}, FY ${y}: ${formatMoney(value)}`}
                      />
                    );
                  })}
                </div>
                <div className="chart-group-name">{c.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- The whole, as a ring -------------------------------------------------

export function CategoryDonut({ categories, categoryTotals, grandTotal, singleYear = false }) {
  const slices = useMemo(() => {
    if (!grandTotal) return [];
    // Everything past the fifth becomes one slice. A ring with fourteen
    // segments is a colour wheel, not a chart.
    const top = categories.slice(0, 5);
    const restTotal = categories.slice(5).reduce((sum, c) => sum + (categoryTotals.get(c.name) || 0), 0);
    const rows = top.map((c) => ({ name: c.name, color: c.color, total: categoryTotals.get(c.name) || 0 }));
    if (restTotal > 0) rows.push({ name: 'Everything else', color: '#94a3b8', total: restTotal });

    let offset = 0;
    return rows.map((r) => {
      const share = (r.total / grandTotal) * 100;
      const slice = { ...r, share, offset };
      offset += share;
      return slice;
    });
  }, [categories, categoryTotals, grandTotal]);

  if (slices.length === 0) return null;

  // One ring drawn as a single circle per slice, each dashed to its own arc
  // and rotated to where it starts. Simpler than building path arcs, and it
  // cannot produce a malformed sweep at 0% or 100%.
  const R = 54;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  return (
    <div className="card report-chart">
      <div className="panel-head">
        <span className="panel-head-mark">
          <Icon name="palette" size={17} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>Total spending by category</h2>
          <p>{singleYear ? 'Where the year went.' : 'Every year added together.'}</p>
        </div>
      </div>

      <div className="donut-row">
        <div className="donut-wrap">
          <svg viewBox="0 0 140 140" role="img" aria-label="Spending by category">
            <g transform="translate(70,70) rotate(-90)">
              <circle r={R} fill="none" stroke="var(--bg-inset)" strokeWidth="19" />
              {slices.map((s) => (
                <motion.circle
                  key={s.name}
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="19"
                  strokeDasharray={`${(s.share / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                  initial={{ strokeDashoffset: -0.0001 }}
                  animate={{ strokeDashoffset: -(s.offset / 100) * CIRCUMFERENCE }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  style={{ transformOrigin: 'center' }}
                >
                  <title>{`${s.name}: ${formatMoney(s.total)}`}</title>
                </motion.circle>
              ))}
            </g>
            {/* Not inside the rotated group, or the words come out sideways. */}
            <text x="70" y="66" textAnchor="middle" className="donut-total">
              {formatMoney(grandTotal)}
            </text>
            <text x="70" y="82" textAnchor="middle" className="donut-caption">
              Total
            </text>
          </svg>
        </div>

        <ul className="donut-legend">
          {slices.map((s) => (
            <li key={s.name}>
              <span className="donut-dot" style={{ background: s.color }} />
              <span className="donut-name">{s.name}</span>
              <span className="donut-share">{s.share.toFixed(0)}%</span>
              <strong className="donut-amount">{formatMoney(s.total)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
