import { useState } from 'react';
import Icon from './Icon.jsx';

// A settings panel that will not accept a press until it is deliberately
// unlocked.
//
// These three — the email server, Firebase, and the default categories every
// new account is built from — are all things that are correct for months at a
// time and then break everything at once if a field is changed while somebody
// is reading it. Nothing here is dangerous to *read*, so the panel stays fully
// visible; it is the editing that has to be asked for.
//
// Not a confirmation dialog: a dialog interrupts somebody who has already
// decided, while this stops the accidental keystroke before it happens and
// leaves the settings legible either way.
export default function LockedPanel({ title, hint, children }) {
  const [unlocked, setUnlocked] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 13px',
          borderRadius: 9,
          border: '1px solid var(--border)',
          borderLeft: `3px solid ${unlocked ? 'var(--amber)' : 'var(--border)'}`,
          background: unlocked ? 'rgba(245, 158, 11, .08)' : 'var(--bg-subtle)',
        }}
      >
        <Icon name={unlocked ? 'pencil' : 'lock'} size={15} style={{ color: unlocked ? 'var(--amber)' : 'var(--text-muted)' }} />
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {unlocked ? `${title} — unlocked` : `${title} is locked`}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {unlocked ? 'Changes take effect as soon as you save them.' : hint}
          </div>
        </div>
        <button
          className={unlocked ? 'btn btn-ghost' : 'btn btn-primary'}
          style={{ fontSize: 12.5, gap: 6 }}
          onClick={() => setUnlocked((v) => !v)}
        >
          <Icon name={unlocked ? 'lock' : 'pencil'} size={13} />
          {unlocked ? 'Lock again' : 'Unlock to edit'}
        </button>
      </div>

      {/* Everything stays readable while locked — inert, not hidden. Somebody
          checking which SMTP host is configured should not have to unlock
          anything to look, and hiding it would only teach them to unlock by
          reflex. */}
      <fieldset
        disabled={!unlocked}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          minInlineSize: 'auto',
          opacity: unlocked ? 1 : 0.72,
          cursor: unlocked ? undefined : 'not-allowed',
        }}
      >
        {children}
      </fieldset>
    </div>
  );
}
