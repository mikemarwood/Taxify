import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import { formatChange, directionOf } from '../lib/change.js';

// One of the figures across the top of the dashboard.
//
// The disc is what separates them at a glance. Four tiles of identical grey
// text are read left to right every time; four colours are recognised, so the
// eye goes straight to the one it came for. The colour is per figure and
// fixed — it means "this is the money one", not "this is good news".
//
// Which is why the movement underneath is coloured separately, and only when
// there is a previous period to compare with. See lib/change.js: a first month
// has nothing behind it, and a tile that fills that silence with a green arrow
// is inventing a trend from one data point.
const TINTS = {
  blue: { bg: 'rgba(21, 89, 184, 0.12)', fg: '#1559b8' },
  green: { bg: 'rgba(12, 115, 67, 0.12)', fg: '#0c7343' },
  violet: { bg: 'rgba(109, 63, 196, 0.12)', fg: '#6d3fc4' },
  amber: { bg: 'rgba(154, 91, 6, 0.13)', fg: '#9a5b06' },
};

export default function StatTile({ icon, tint = 'blue', label, value, change, changeNote, delay = 0, children }) {
  const disc = TINTS[tint] || TINTS.blue;
  const direction = directionOf(change);
  const percent = formatChange(change);

  // Green up, red down, grey for no movement at all. The arrow points the same
  // way the colour says, so the direction survives for anyone who cannot
  // separate the two hues — colour is never the only thing carrying it.
  const TONE = {
    up: { colour: 'var(--green)', icon: 'arrow-up' },
    down: { colour: 'var(--red)', icon: 'arrow-down' },
    flat: { colour: 'var(--text-muted)', icon: null },
  };
  const tone = TONE[direction] || TONE.flat;

  return (
    <motion.div
      className="card stat-tile"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <span className="stat-tile-mark" style={{ background: disc.bg, color: disc.fg }}>
        <Icon name={icon} size={20} />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="stat-tile-label">{label}</div>
        <div className="stat-tile-value">{value}</div>

        {percent && (
          <div className="stat-tile-change" style={{ color: tone.colour }}>
            {tone.icon && <Icon name={tone.icon} size={13} />}
            <strong>{percent}</strong>
            {changeNote && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{changeNote}</span>}
          </div>
        )}

        {children}
      </div>
    </motion.div>
  );
}
