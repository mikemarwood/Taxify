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

      {/* One line, and it stays one line.

          It wrapped, so on anything short of a wide column the hours sat above
          the minutes and the control read as two separate questions — which is
          exactly what the picker exists not to be. The row scrolls sideways
          instead on the rare width where it genuinely will not fit, which is
          better than folding: a stepper and four buttons side by side are one
          thing, and stacked they are two. */}
      {/* One line on a desktop, two on a phone.

          It was nowrap with a sideways scroll, on the reasoning that a stepper
          and four buttons side by side are one control and stacked they are
          two. That holds at a desk. On a 360px screen it does not: the minutes
          half sat off the right edge behind a scrollbar nobody sees, so the
          control looked cut off rather than scrollable and half of it was
          simply unreachable.

          Hours on one row and minutes on the next is the honest answer at that
          width — see .hours-row in theme.css, which flips it. */}
      <div
        className="hours-row"
        style={{
          minHeight: CONTROL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
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
                  minWidth: 36,
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

      {/* What is about to be logged, said properly.

          It was 11.5px grey text reading "2h 30m" — the same size as a hint,
          under two rows of controls, saying the one thing on this form that is
          actually being claimed. It reads "2 hours 30 minutes" now, at a size
          that matches its importance rather than its position, in a box that
          holds its shape whether there is a figure in it or not so the form
          below does not shift as the numbers change.

          Words rather than the h/m shorthand, because this is the value being
          checked before it is saved and "2h 30m" is a thing to decode. The
          decimal the database keeps is nobody's business but ours. */}
      <div
        aria-live="polite"
        style={{
          marginTop: 6,
          minHeight: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '4px 10px',
          borderRadius: 8,
          border: `1px solid ${h === 0 && m === 0 ? 'var(--border)' : 'var(--emerald)'}`,
          background: h === 0 && m === 0 ? 'var(--bg-inset)' : 'rgba(12, 115, 67, 0.08)',
          alignSelf: 'flex-start',
        }}
      >
        <Icon
          name="clock"
          size={14}
          style={{ color: h === 0 && m === 0 ? 'var(--text-subtle)' : 'var(--emerald)', flexShrink: 0 }}
        />
        {h === 0 && m === 0 ? (
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No time chosen yet</span>
        ) : (
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--emerald)' }}>
            {h > 0 && `${h} ${h === 1 ? 'hour' : 'hours'}`}
            {h > 0 && m > 0 && ' '}
            {m > 0 && `${m} minutes`}
          </span>
        )}
      </div>
    </div>
  );
}
