import { useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';

// One-off tools.
//
// Kept together and labelled as temporary on purpose. Things like this get
// built for one afternoon's problem and then live forever because nobody
// remembers which parts of the admin panel were meant to be thrown away — so
// the page says so out loud.

function Tool({ title, warning, children }) {
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
      {warning && (
        <div
          style={{
            display: 'flex',
            gap: 9,
            alignItems: 'flex-start',
            padding: '10px 12px',
            borderRadius: 9,
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--amber)',
            background: 'rgba(245, 158, 11, .08)',
          }}
        >
          <Icon name="alert" size={14} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 12, lineHeight: 1.55 }}>{warning}</span>
        </div>
      )}
      {children}
    </div>
  );
}

// One number and what it counts, so the three read as a row of figures rather
// than a sentence somebody has to parse.
function Figure({ n, label, tone }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
      <strong style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', color: tone || 'var(--text)' }}>{n}</strong>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    </span>
  );
}

// Accounts that paid and stayed locked out.
//
// Subscription state only ever reached us by webhook. If one was delayed,
// rejected on a stale signing secret, or never switched on in the dashboard,
// somebody paid and nothing happened — and the app could not notice, because
// the thing that was going to tell it is the thing that failed.
function ReconcileTool() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post('/admin/tools/reconcile-subscriptions');
      setResult(res.data);
      toast(
        res.data.fixed.length
          ? `${res.data.fixed.length} account${res.data.fixed.length === 1 ? '' : 's'} put right`
          : 'Nothing needed changing',
        res.data.fixed.length ? 'success' : 'info'
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tool
      title="Put right anyone who paid and stayed locked out"
    >
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Asks Stripe about every account we hold a customer for and writes back what it says. Safe to run twice — it
        only ever copies Stripe, and it reports what it changed rather than saying it is done.
      </div>

      <button className="btn btn-primary" style={{ fontSize: 13, alignSelf: 'flex-start' }} disabled={busy} onClick={run}>
        {busy && <span className="spinner" />}
        Check every account against Stripe
      </button>

      {/* A report, not a sentence.

          It used to say "Checked 1. None were wrong." — which is the right
          facts and no help at all: it does not say what was compared, what
          "wrong" would have meant, or whether an empty result is the tool
          working or the tool finding nothing to look at. Somebody runs this
          when a customer says they have paid and cannot get in, and they need
          to be able to tell those two apart. */}
      {result && (
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.6,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-inset)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '2px 18px',
              padding: '10px 13px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
            }}
          >
            <Figure n={result.checked} label={result.checked === 1 ? 'account checked' : 'accounts checked'} />
            <Figure
              n={result.fixed.length}
              label={result.fixed.length === 1 ? 'put right' : 'put right'}
              tone={result.fixed.length ? 'var(--emerald)' : undefined}
            />
            <Figure
              n={result.problems?.length || 0}
              label="could not be read"
              tone={result.problems?.length ? 'var(--red)' : undefined}
            />
          </div>

          <div style={{ padding: '10px 13px' }}>
            {result.checked === 0 ? (
              // Not the same as "nothing was wrong", and the difference matters:
              // it means nobody has ever reached Stripe checkout, so a customer
              // saying they paid did it somewhere this tool cannot see.
              <span style={{ color: 'var(--text-muted)' }}>
                No account on this site has a Stripe customer against it, so there was nothing to compare. If somebody
                says they have paid, their payment did not come through Stripe checkout here.
              </span>
            ) : result.fixed.length === 0 && !result.problems?.length ? (
              <span style={{ color: 'var(--text-muted)' }}>
                Every account already matches what Stripe says about it — same status, same plan, same renewal date.
                Nothing needed changing, and nobody is locked out because of a missed webhook. If somebody still cannot
                get in, the cause is not their subscription.
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>
                Compared each account's status, plan and renewal date against Stripe, and wrote back where they
                differed.
              </span>
            )}

            {result.fixed.map((f) => (
              <div key={f.id} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <strong>{f.name || f.email}</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                  {f.was || 'nothing'} → <strong style={{ color: 'var(--emerald)' }}>{f.now}</strong>
                  {f.endsAt ? `, until ${new Date(f.endsAt).toLocaleDateString()}` : ''}
                </div>
              </div>
            ))}

            {result.problems?.map((p) => (
              <div
                key={p.email}
                style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', color: 'var(--red)' }}
              >
                <strong>{p.email}</strong>
                <div style={{ marginTop: 1 }}>{p.error}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Tool>
  );
}

export default function ToolsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Temporary. These were built for particular one-off jobs and are meant to be deleted once those are done —
        they are kept together and said to be temporary so it is obvious later which parts of this panel were never
        meant to stay.
      </p>
      <ReconcileTool />
    </div>
  );
}
