import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';

// A nudge to put a face on the account, asked occasionally rather than
// constantly.
//
// It matters more than it sounds on this app in particular: an accountant's
// client list and a set of shared books are both lists of people, and initials
// in a circle are a list you read rather than one you recognise.
//
// "Sometimes" is the whole design. A prompt that returns on every page load is
// a prompt people learn not to see, and one that never returns is one that a
// mis-tap dismisses for ever. Put off for a fortnight, and gone for good once
// there is a photo — because then there is nothing left to ask.
const SNOOZE_DAYS = 14;
const KEY = 'taxify.avatarPrompt.snoozedUntil';

function snoozed() {
  try {
    const until = Number(window.localStorage.getItem(KEY) || 0);
    return until > Date.now();
  } catch {
    // Private browsing, or storage turned off. Better to ask than to crash on
    // the way to asking.
    return false;
  }
}

export default function AvatarPrompt() {
  const { user } = useAuth();
  const [hidden, setHidden] = useState(() => snoozed());

  // Nothing to ask an accountant acting inside somebody else's books: the
  // account on screen is not theirs to change.
  if (hidden || !user || user.avatarUrl || user.actingAsClient) return null;

  function laterOn() {
    try {
      window.localStorage.setItem(KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    } catch {
      // The dismissal still works for this visit, which is the half that
      // matters to somebody reading the page right now.
    }
    setHidden(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card"
      style={{
        padding: 16,
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        borderLeft: '3px solid var(--accent)',
      }}
    >
      {/* Their initials, which is exactly what everyone else sees of them —
          the ask and the reason for it in the same object. */}
      <span style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar name={user.name} size={46} />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: -3,
            bottom: -3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent)',
            color: '#fff',
            border: '2px solid var(--bg-card)',
          }}
        >
          <Icon name="camera" size={11} />
        </span>
      </span>

      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Add a photo to your account</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.55 }}>
          It shows on your books, beside anything you add, and on your accountant's client list. Takes a moment, and
          only you and the people you share with ever see it.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link
          to="/account?tab=profile"
          className="btn btn-primary"
          style={{ fontSize: 13, textDecoration: 'none' }}
        >
          <Icon name="camera" size={15} />
          Add a photo
        </Link>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={laterOn}>
          Not now
        </button>
      </div>
    </motion.div>
  );
}
