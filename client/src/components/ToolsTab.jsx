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

      {result && (
        <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <div style={{ color: 'var(--text-muted)' }}>
            Checked {result.checked}. {result.fixed.length === 0 ? 'None were wrong.' : ''}
          </div>
          {result.fixed.map((f) => (
            <div key={f.id} style={{ marginTop: 5 }}>
              <strong>{f.name || f.email}</strong> — {f.was || 'nothing'} → {f.now}
              {f.endsAt ? `, until ${new Date(f.endsAt).toLocaleDateString()}` : ''}
            </div>
          ))}
          {result.problems?.map((p) => (
            <div key={p.email} style={{ marginTop: 5, color: 'var(--red)' }}>
              {p.email} — {p.error}
            </div>
          ))}
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
