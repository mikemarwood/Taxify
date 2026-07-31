import { useState } from 'react';
import Icon from './Icon.jsx';

// Mirrors isStrongPassword on the server. Shown as a live checklist rather
// than one pass/fail message, so it's obvious which rule is still unmet
// instead of guessing after a rejection.
export const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A number', test: (p) => /\d/.test(p) },
];

export function isStrongPassword(password) {
  return PASSWORD_RULES.every((r) => r.test(password));
}

// The new-password pair used wherever a password is chosen: activating an
// account, accepting an invite, resetting a forgotten one. One component so
// the rules can't drift between them.
export default function PasswordFields({ password, setPassword, confirmPassword, setConfirmPassword, autoFocus }) {
  const [show, setShow] = useState(false);
  const matches = password.length > 0 && password === confirmPassword;

  return (
    <>
      <div>
        <label className="label">New password</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus={autoFocus}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12.5, padding: '7px 12px' }}
            onClick={() => setShow((v) => !v)}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <li
              key={rule.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12.5,
                color: met ? 'var(--emerald)' : 'var(--text-muted)',
              }}
            >
              <Icon name={met ? 'check-circle' : 'info'} size={13} />
              {rule.label}
            </li>
          );
        })}
      </ul>

      <div>
        <label className="label">Confirm password</label>
        <input
          className="input"
          type={show ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
        {confirmPassword && !matches && (
          <span style={{ fontSize: 11.5, color: 'var(--red)' }}>The passwords don’t match</span>
        )}
      </div>
    </>
  );
}
