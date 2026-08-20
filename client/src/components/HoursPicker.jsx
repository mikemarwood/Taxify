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
const QUARTERS = [0, 15, 30, 45];
const MAX_HOURS = 24;

function Step({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30,
        height: 30,
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
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Hours
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Step label="One hour less" disabled={disabled || h <= 0} onClick={() => onChange(h - 1, m)} />
          <span
            aria-live="polite"
            style={{
              minWidth: 34,
              textAlign: 'center',
              fontSize: 16,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {h}
          </span>
          <Step label="Add an hour" disabled={disabled || h >= MAX_HOURS} onClick={() => onChange(h + 1, m)} />
        </div>
      </div>

      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Minutes
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          {QUARTERS.map((value) => {
            const on = m === value;
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => onChange(h, value)}
                style={{
                  minWidth: 40,
                  padding: '7px 0',
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
        </div>
      </div>

      {/* What is about to be logged, in the form it will be read back in.
          The decimal the database keeps is nobody's business but ours. */}
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', paddingBottom: 8 }}>
        {h === 0 && m === 0 ? (
          'Nothing yet'
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
