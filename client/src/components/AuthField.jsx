import { useState } from 'react';
import Icon from './Icon.jsx';

// A signed-out field: the icon inside the box, and a reveal for a password.
//
// The icon is decorative and marked so — the visible label above the field is
// what a screen reader reads out, and an envelope announced before it would be
// noise. The reveal is a real button with a real name, because it is the one
// control here somebody may need to find without seeing it.
//
// A placeholder as well as a label, matching the design. Never a placeholder
// instead of one: it disappears the moment somebody types, and then the field
// they are halfway through filling in has nothing saying what it is.
export default function AuthField({
  icon,
  label,
  type = 'text',
  reveal = false,
  value,
  onChange,
  ...rest
}) {
  const [shown, setShown] = useState(false);
  const inputType = reveal ? (shown ? 'text' : 'password') : type;

  return (
    <div>
      <label className="label">{label}</label>
      <div className="auth-field">
        <Icon name={icon} size={17} aria-hidden="true" />
        <input
          className={`input${reveal ? ' has-reveal' : ''}`}
          type={inputType}
          value={value}
          onChange={onChange}
          {...rest}
        />
        {reveal && (
          <button
            type="button"
            className="auth-reveal"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide password' : 'Show password'}
          >
            {/* Drawn here rather than taken from Icon: the set has no eye, and
                borrowing a shape that means something else elsewhere in the app
                is worse than eight lines of path. */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
              <circle cx="12" cy="12" r="2.8" />
              {!shown && <path d="M4 20L20 4" />}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
