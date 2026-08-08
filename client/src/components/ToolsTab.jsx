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

function AccountNumberTool() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post('/admin/tools/account-number', { email: email.trim().toLowerCase() });
      setResult(res.data);
      toast(`Given ${res.data.accountNumber}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tool title="Give an account its number">
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        Account numbers are handed out at registration, so anybody who signed up before that existed has none. This
        gives them one. It refuses an account that already has a number — that number is what somebody quotes back to
        support, so two of them meaning one account is worse than one account missing one.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          type="email"
          placeholder="their@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value.toLowerCase())}
          style={{ flex: '1 1 240px', fontSize: 13 }}
        />
        <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!email.trim() || busy} onClick={run}>
          {busy && <span className="spinner" />}
          Give a number
        </button>
      </div>
      {result && (
        <div style={{ fontSize: 12.5 }}>
          <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15 }}>{result.accountNumber}</strong>{' '}
          <span style={{ color: 'var(--text-muted)' }}>for {result.email}</span>
        </div>
      )}
    </Tool>
  );
}

function CopyAccountTool() {
  const toast = useToast();
  const confirm = useConfirm();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);

  async function look() {
    setBusy(true);
    setCheck(null);
    try {
      const res = await api.get(
        `/admin/tools/account-copy/check?from=${encodeURIComponent(from.trim().toLowerCase())}&to=${encodeURIComponent(
          to.trim().toLowerCase()
        )}`
      );
      setCheck(res.data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    const s = check.source.summary;
    const ok = await confirm({
      tone: 'danger',
      title: `Copy ${check.source.email} into ${check.target.email}?`,
      body: (
        <>
          <div style={{ marginBottom: 8 }}>
            {s.books} books, {s.categories} categories, {s.expenses} expenses and {s.receipts} receipt files are
            duplicated. The originals are not touched.
          </div>
          <div>
            The two accounts are independent afterwards — deleting one leaves the other whole. Sign-ins, notifications,
            support tickets and anything to do with billing are not copied.
          </div>
        </>
      ),
      requireText: 'copy',
      confirmLabel: 'Copy it',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api.post('/admin/tools/account-copy', {
        from: from.trim().toLowerCase(),
        to: to.trim().toLowerCase(),
      });
      toast(res.data.warning || `Copied, with ${res.data.files} files`, res.data.warning ? 'error' : 'success');
      setCheck(null);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tool
      title="Copy one account into another"
      warning="The account being copied into must be empty, and this cannot be undone. Everything is duplicated, including every receipt on disk, so the two accounts are genuinely independent afterwards."
    >
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            Copy from
          </label>
          <input
            className="input"
            type="email"
            placeholder="source@email.com"
            value={from}
            onChange={(e) => {
              setCheck(null);
              setFrom(e.target.value.toLowerCase());
            }}
            style={{ fontSize: 13 }}
          />
        </div>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            Copy into (must be empty)
          </label>
          <input
            className="input"
            type="email"
            placeholder="target@email.com"
            value={to}
            onChange={(e) => {
              setCheck(null);
              setTo(e.target.value.toLowerCase());
            }}
            style={{ fontSize: 13 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 13 }}
          disabled={!from.trim() || !to.trim() || busy}
          onClick={look}
        >
          {busy && !check && <span className="spinner" />}
          Check first
        </button>
        {check && !check.problem && (
          <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy} onClick={run}>
            {busy && <span className="spinner" />}
            Copy everything
          </button>
        )}
      </div>

      {check && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[check.source, check.target].map((side, i) => (
            <div key={side.email} style={{ fontSize: 12.5 }}>
              <strong>{i === 0 ? 'From' : 'Into'}:</strong> {side.name} · {side.email}
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                {side.summary.books} books · {side.summary.categories} categories · {side.summary.expenses} expenses ·{' '}
                {side.summary.receipts} receipts · {side.summary.documents} documents
              </div>
            </div>
          ))}
          {check.problem && (
            <div style={{ fontSize: 12.5, color: 'var(--red)', fontWeight: 600 }}>{check.problem}</div>
          )}
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
      <AccountNumberTool />
      <CopyAccountTool />
    </div>
  );
}
