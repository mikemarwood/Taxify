import Icon from './Icon.jsx';

// How long somebody worked from home.
//
// It was two dropdowns, which are correct and joyless: opening a list of
// twenty-five numbers to say "two hours" is more work than the entry deserves,
// and on a phone it is a full-screen wheel each time.
//
// Hours get a stepper, because the number is almost always small and one press
// away from the last one. Minutes get four buttons, because home-office time is
// logged to the quarter hour and nobody has ever needed to claim seven minutes.
//
// It sits in a row of ordinary fields, so it is shaped like one: a single
// label on the same line as its neighbours', one control block the same height
// as an input, and the running total underneath. Two inner labels of its own
// used to make this cell taller than the fields either side of it, which
// bumped the whole column half a line up out of the row.
const QUARTERS = [0, 15, 30, 45];
const MAX_HOURS = 24;

// The height of a .input: 14px of text, 9px of padding either side, a border.
const CONTROL_HEIGHT = 38;

function Unit({ children }) {
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-subtle)', letterSpacing: 0.3 }}>
      {children}
    </span>
  );
}

function Step({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: disabled ? 'var(--text-subtle)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: 'inherit',
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {label === 'Add an hour' ? '+' : '−'}
    </button>
  );
}

export default function HoursPicker({ hours, minutes, onChange, disabled = false }) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;

  return (
    <div>
      <label className="label">Time worked</label>

      <div
        style={{
          minHeight: CONTROL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Step label="One hour less" disabled={disabled || h <= 0} onClick={() => onChange(h - 1, m)} />
          <span
            aria-live="polite"
            style={{
              minWidth: 26,
              textAlign: 'center',
              fontSize: 16,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {h}
          </span>
          <Step label="Add an hour" disabled={disabled || h >= MAX_HOURS} onClick={() => onChange(h + 1, m)} />
          <Unit>hr</Unit>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {QUARTERS.map((value) => {
            const on = m === value;
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-label={`${value} minutes`}
                onClick={() => onChange(h, value)}
                style={{
                  minWidth: 38,
                  height: 32,
                  borderRadius: 8,
                  cursor: disabled ? 'default' : 'pointer',
                  font: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'var(--accent)' : 'var(--bg-card)',
                  color: on ? '#fff' : 'var(--text-muted)',
                }}
              >
                {String(value).padStart(2, '0')}
              </button>
            );
          })}
          <Unit>min</Unit>
        </div>
      </div>

      {/* What is about to be logged, in the form it will be read back in, and
          in the same place the odometer puts its running distance. The decimal
          the database keeps is nobody's business but ours. */}
      <div style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
        {h === 0 && m === 0 ? (
          <span style={{ color: 'var(--text-muted)' }}>Nothing yet</span>
        ) : (
          <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>
            <Icon name="clock" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            {h ? `${h}h` : ''}
            {h && m ? ' ' : ''}
            {m ? `${m}m` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
