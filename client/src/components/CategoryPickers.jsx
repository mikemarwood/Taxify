import Icon from './Icon.jsx';
import { ICON_OPTIONS } from '../lib/categoryIcons.js';

export const SWATCHES = [
  '#8b5cf6',
  '#06b6d4',
  '#f59e0b',
  '#ec4899',
  '#10b981',
  '#3b82f6',
  '#ef4444',
  '#eab308',
  '#14b8a6',
  '#a1a1aa',
];

// The icon is what you actually scan for in a list of categories, so it is
// drawn at a size you can recognise — in the picker too, because choosing a
// 15px glyph from a grid of 15px glyphs is guesswork.
export function IconPicker({ value, onChange, label = 'Icon' }) {
  return (
    <div>
      {label && (
        <div className="label" style={{ marginBottom: 6 }}>
          {label}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))', gap: 6 }}>
        {ICON_OPTIONS.map((icon) => {
          const selected = value === icon;
          return (
            <button
              type="button"
              key={icon}
              onClick={() => onChange(icon)}
              title={icon.replace(/-/g, ' ')}
              style={{
                height: 46,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                color: selected ? 'var(--accent)' : 'var(--text-muted)',
                background: selected ? 'var(--accent-soft)' : 'var(--bg-inset)',
                border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <Icon name={icon} size={22} strokeWidth={selected ? 2 : 1.7} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ColourPicker({ value, onChange, label = 'Colour' }) {
  return (
    <div>
      {label && (
        <div className="label" style={{ marginBottom: 6 }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SWATCHES.map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => onChange(s)}
            aria-label={s}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: s,
              border: value === s ? '3px solid var(--bg-elevated)' : '3px solid transparent',
              boxShadow: value === s ? `0 0 0 2px ${s}` : 'none',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// The tile a category will actually appear as, so the icon and colour are
// chosen against the thing they end up on rather than in the abstract.
export function CategoryPreview({ icon, color, size = 58 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `${color}1f`,
        border: `1px solid ${color}55`,
        color,
        flexShrink: 0,
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.48)} />
    </div>
  );
}
