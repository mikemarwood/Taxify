import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import Icon from './Icon.jsx';

// An accountant taking an ordinary Taxify account on the same login.
//
// It used to be one button that did it immediately, on Individual, because
// that is what the endpoint hardcoded. Two things wrong with that: the plan was
// picked for them, and a single press changed what their login is — no
// question asked, no way to look at it first and decide not to.
//
// So: choose, then confirm. Offered in two places (the client list and account
// settings), which is why it is a component and not written twice.
const PLANS = [
  {
    id: 'individual',
    name: 'Individual',
    line: 'Your own expenses and receipts, one set of books.',
    detail: 'For a personal return.',
  },
  {
    id: 'business',
    name: 'Small Business',
    line: 'Everything in Individual, plus up to two businesses.',
    detail: 'Separate books per business, kept apart at every total.',
  },
];

export default function StartOwnAccount({ label = 'Start tracking my own expenses' }) {
  const { refresh } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();

  // Nothing is preselected. A plan somebody scrolled past is not a plan they
  // chose, and the button says which one it is about to start.
  const [choosing, setChoosing] = useState(false);
  const [planType, setPlanType] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = PLANS.find((p) => p.id === planType);

  async function start() {
    if (!chosen) return;
    const ok = await confirm({
      title: `Start your own account on ${chosen.name}?`,
      body:
        'This login becomes an ordinary Taxify account as well as an accountant one. Your 14-day trial starts ' +
        'today, nothing is charged until it ends, and every client you already act for stays exactly as it is. ' +
        'You can change plan later from My account.',
      confirmLabel: `Start on ${chosen.name}`,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api.post('/auth/start-own-account', { planType: chosen.id });
      await refresh();
      // Somebody who has had their trial before gets no countdown, so the
      // message does not promise one. The server says which it was.
      toast(
        res.data?.trialGranted
          ? `Your ${chosen.name} account is ready — your 14-day trial has started`
          : `Your ${chosen.name} account is ready — add a payment method to keep it open`,
        'success'
      );
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  if (!choosing) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: 13, alignSelf: 'flex-start' }}
        onClick={() => setChoosing(true)}
      >
        {label}
      </button>
    );
  }

  return (
    // A whole line to itself once it is open, so it does not try to share a
    // row with whatever button was next to the closed one.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', flex: '1 1 100%' }}>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Which plan would you like to trial?</div>

      <div style={{ display: 'grid', gap: 10 }}>
        {PLANS.map((p) => {
          const on = planType === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlanType(p.id)}
              aria-pressed={on}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 11,
                textAlign: 'left',
                padding: '13px 15px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                font: 'inherit',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'var(--accent-soft)' : 'var(--bg-card)',
              }}
            >
              {/* A radio drawn rather than an <input>, so the whole card is the
                  target — on a phone a 14px circle is not one. */}
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  marginTop: 2,
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: `2px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: on ? 'var(--accent)' : 'transparent',
                  boxShadow: on ? 'inset 0 0 0 3px var(--bg-card)' : 'none',
                }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{p.line}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>{p.detail}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
        14 days free, nothing charged until it ends, and you can change plan later from My account.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: 13 }}
          disabled={busy || !chosen}
          onClick={start}
        >
          {busy && <span className="spinner" />}
          {chosen ? `Continue with ${chosen.name}` : 'Choose a plan'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 13, gap: 7 }}
          disabled={busy}
          onClick={() => {
            setChoosing(false);
            setPlanType('');
          }}
        >
          <Icon name="arrow-left" size={15} />
          Back
        </button>
      </div>
    </div>
  );
}
