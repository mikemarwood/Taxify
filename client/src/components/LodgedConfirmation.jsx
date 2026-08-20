import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon.jsx';

// What you see the moment something is lodged.
//
// The three things you can add — a receipt, a trip, hours at home — each said
// so differently. A receipt got a card with a tick and took you to the
// dashboard after a couple of seconds; a trip got a line of green text and left
// you on the form wondering whether to press it again. Same act, three answers.
//
// The countdown is shown rather than hidden. A page that navigates on its own
// after a silent pause is a page that feels like it did something you did not
// ask for — saying "in 3" turns the same behaviour into something you can
// watch, and Stay here turns it off for somebody who has five more to enter.
//
// The sound belongs to the caller, not here: it plays on the response, which is
// a moment earlier than this appears, and a component that made a noise when it
// mounted would double up with anything else that already did.

const SECONDS = 4;

export default function LodgedConfirmation({ title, detail, reference, onDone, onAgain, againLabel = 'Add another' }) {
  const [left, setLeft] = useState(SECONDS);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    if (holding) return undefined;
    if (left <= 0) {
      onDone();
      return undefined;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, holding]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card"
      role="status"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 14,
        borderTop: '3px solid var(--emerald)',
      }}
    >
      <motion.span
        initial={{ scale: 0.4, rotate: -14 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 15 }}
        style={{
          width: 62,
          height: 62,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(12, 115, 67, 0.12)',
          color: 'var(--emerald)',
          flexShrink: 0,
        }}
      >
        <Icon name="check-circle" size={34} />
      </motion.span>

      <div>
        <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: -0.3 }}>{title}</div>
        {detail && (
          <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.6 }}>{detail}</div>
        )}
      </div>

      {/* The reference, for the one conversation a year where somebody has to
          name a particular entry. */}
      {reference && (
        <span
          title="The reference for this entry"
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontWeight: 700,
            fontSize: 12.5,
            padding: '3px 10px',
            borderRadius: 6,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border)',
          }}
        >
          #{reference}
        </span>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary" style={{ fontSize: 13 }} onClick={onDone}>
          {holding ? 'Go to dashboard' : `Go to dashboard (${left})`}
        </button>
        {onAgain && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onAgain}>
            {againLabel}
          </button>
        )}
        {!holding && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 13 }}
            onClick={() => setHolding(true)}
          >
            Stay here
          </button>
        )}
      </div>
    </motion.div>
  );
}
