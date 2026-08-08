import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { filingNoun } from '../lib/taxWords.js';
import { useLockBodyScroll } from '../lib/useLockBodyScroll.js';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { planLabel } from '../lib/plans.js';
import { formatDateLong } from '../lib/dates.js';
import Icon from './Icon.jsx';

// What a plan change costs, said before it is made.
//
// The figure comes from Stripe's own preview of the invoice it is about to
// raise, not from arithmetic here. Anything we worked out ourselves would be a
// second opinion, and the one that matters is the one that ends up on the card.

function money(cents, currency) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
    minimumFractionDigits: Math.abs(cents) % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export default function PlanChangeDialog({ planType, busy, onConfirm, onCancel }) {
  const { user } = useAuth();
  const filingWord = filingNoun(user?.country);
  // The page behind must not move while this is over it.
  useLockBodyScroll(open);
  const [preview, setPreview] = useState(undefined); // undefined = still asking
  const label = planLabel(planType);

  useEffect(() => {
    let cancelled = false;
    setPreview(undefined);
    api
      .get(`/billing/change-preview?planType=${encodeURIComponent(planType)}`)
      .then((res) => !cancelled && setPreview(res.data.preview))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [planType]);

  // Escape closes it, the same as clicking Cancel.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const upgrading = planType === 'business';
  const credit = preview && preview.dueNow < 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !busy && onCancel()}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(8, 14, 24, 0.55)',
          backdropFilter: 'blur(2px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          zIndex: 1400,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="card"
          role="dialog"
          aria-modal="true"
          aria-label={`Move to ${label}`}
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100%', maxWidth: 440, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: 19 }}>Move to {label}</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {upgrading
                ? `Your own tax plus up to two businesses, each with its own categories, reports and ${filingWord}.`
                : 'Your own tax, one set of books. Any businesses you already have are kept — you just cannot add more.'}
            </p>
          </div>

          {preview === undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--text-muted)' }}>
              <span className="spinner" />
              Working out what this costs…
            </div>
          )}

          {preview && (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {credit ? 'Credited to your account' : 'To pay today'}
                </span>
                <span style={{ fontSize: 22, fontWeight: 800, color: credit ? 'var(--emerald)' : 'var(--text)' }}>
                  {money(Math.abs(preview.dueNow), preview.currency)}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                {credit
                  ? 'The unused part of what you have already paid stays on your account and comes off your next renewal.'
                  : 'Only the difference for the time left on the year you have already paid for.'}
              </p>

              {/* The reassurance that matters most: changing plan does not
                  restart the year they bought. */}
              {preview.renewsAt && (
                <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
                  <Icon name="check-circle" size={15} style={{ color: 'var(--emerald)', flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Your renewal date does not change — still{' '}
                    <strong style={{ color: 'var(--text)' }}>{formatDateLong(preview.renewsAt)}</strong>.
                  </span>
                </div>
              )}
            </div>
          )}

          {preview === null && (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              You have no subscription running yet, so you will be taken to checkout to start one. Nothing is charged
              until you finish there.
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy} style={{ fontSize: 13 }}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirm}
              disabled={busy || preview === undefined}
              style={{ fontSize: 13 }}
            >
              {busy && <span className="spinner" />}
              {preview === null ? 'Continue to checkout' : `Move to ${label}`}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
