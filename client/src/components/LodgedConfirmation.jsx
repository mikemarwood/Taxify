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

      {/* The reference, given the weight of the thing it is.
          
          It was a small grey chip, which is what you use for a tag rather than
          for the one piece of information this card exists to hand over: the
          number that finds this entry again, and the same number printed on
          the record itself. Labelled, spaced, and in tabular figures so the
          digits can be read off aloud without losing your place. */}
      {reference && (
        <div
          style={{
            width: '100%',
            maxWidth: 260,
            padding: '11px 14px',
            borderRadius: 10,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Reference
          </div>
          <div
            style={{
              marginTop: 3,
              fontFamily: 'ui-monospace, monospace',
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: 0.6,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            #{reference}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary" style={{ fontSize: 13 }} onClick={onDone}>
          Go to dashboard
        </button>
        {onAgain && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 13 }}
            onClick={() => {
              // Stops the clock as well as clearing the form. Without this the
              // countdown carried on underneath and took somebody to the
              // dashboard mid-way through typing the next expense.
              setHolding(true);
              onAgain();
            }}
          >
            {againLabel}
          </button>
        )}
        {/* No "Stay here".
            Add another already holds the page — it is the reason somebody
            would want to stay, and it says what happens next instead of only
            what does not. Three buttons for two decisions is one too many. */}
      </div>

      {/* The countdown, said quietly and underneath rather than counted down
          inside the button.
          
          "Go to dashboard (3)" reads as a deadline on a card somebody is still
          reading — and the one thing on it worth reading is a reference number
          they may want to write down. The page still leaves on its own; it
          just stops appearing to hurry. */}
      {!holding && left > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
          Going to the dashboard in {left} second{left === 1 ? '' : 's'}
        </div>
      )}
    </motion.div>
  );
}
