import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { parseAmount, amountWhileTyping, amountOnBlur } from '../lib/money.js';
import Avatar from './Avatar.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { formatDateLong } from '../lib/dates.js';
import { planLabel } from '../lib/plans.js';

const STATUS = {
  pending: { label: 'Waiting on us', colour: 'var(--amber)' },
  invoiced: { label: 'Invoice sent', colour: 'var(--accent)' },
  paid: { label: 'Paid', colour: 'var(--emerald)' },
  cancelled: { label: 'Cancelled', colour: 'var(--text-muted)' },
};

function money(cents, currency) {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'AUD').toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

// The invoice an administrator raises against a plan change. The amount is
// typed rather than looked up: this path exists for what the price list cannot
// express — a part year, an agreed rate, two businesses at a negotiated price.
function InvoiceForm({ request, onSent, onCancel }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState(
    `Taxify — change to the ${planLabel(request.toPlan)} plan`
  );
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);

  const value = parseAmount(amount) ?? NaN;
  const valid = Number.isFinite(value) && value > 0 && value <= 100000;

  async function send() {
    setBusy(true);
    try {
      const res = await api.post(`/admin/plan-requests/${request.id}/invoice`, {
        amount: value,
        description: description.trim(),
        daysUntilDue: days,
      });
      toast('Invoice sent', 'success');
      onSent(res.data);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10 }}>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            Amount (AUD)
          </label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="149.00"
            value={amount}
            onChange={(e) => setAmount(amountWhileTyping(e.target.value))}
            onBlur={() => setAmount(amountOnBlur(amount))}
            style={{ fontSize: 13 }}
          />
        </div>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            What it is for
          </label>
          <input
            className="input"
            maxLength={300}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ fontSize: 13 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Due in</span>
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            type="button"
            className={days === d ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ fontSize: 12, padding: '5px 10px' }}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Stripe emails the invoice. Their plan moves to <strong>{planLabel(request.toPlan)}</strong> automatically when
        Stripe confirms it is paid — not before, and nothing here charges a card.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!valid || busy} onClick={send}>
          {busy && <span className="spinner" />}
          Send invoice
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 13 }} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function PlanRequestsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState(null);
  const [invoicing, setInvoicing] = useState(null);

  function load() {
    api
      .get('/admin/plan-requests')
      .then((res) => setRequests(res.data.requests))
      .catch((err) => {
        toast(err.message, 'error');
        setRequests([]);
      });
  }

  useEffect(load, []);

  async function dismiss(request) {
    if (
      !(await confirm({
        title: `Cancel ${request.name}'s request?`,
        body:
          request.status === 'invoiced'
            ? 'The invoice stays in Stripe — void it there if it should not be collected. Their plan will not change.'
            : 'Their plan will not change. They can ask again.',
        confirmLabel: 'Cancel request',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }
    try {
      await api.delete(`/admin/plan-requests/${request.id}`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!requests) return <div className="card" style={{ padding: 20, fontSize: 13 }}>Loading…</div>;

  if (requests.length === 0) {
    return (
      <div className="card" style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        No plan changes have been asked for. One appears here whenever somebody asks to move plan, and you send them an
        invoice from here.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {requests.map((r) => {
        const status = STATUS[r.status] || STATUS.pending;
        return (
          <div key={r.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Avatar name={r.name} avatarUrl={r.avatarUrl} size={34} />
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{r.email}</div>
              </div>

              <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: 'var(--text-muted)' }}>{planLabel(r.fromPlan || r.currentPlan)}</span>
                <Icon name="arrow-right" size={13} style={{ color: 'var(--text-muted)' }} />
                <strong>{planLabel(r.toPlan)}</strong>
              </div>

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  padding: '3px 9px',
                  borderRadius: 999,
                  color: status.colour,
                  border: `1px solid var(--border)`,
                  background: 'var(--bg-subtle)',
                }}
              >
                {status.label}
              </span>
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
              Asked {formatDateLong(r.createdAt)}
              {r.invoicedAt && ` · invoiced ${money(r.invoiceAmountCents, r.invoiceCurrency)} on ${formatDateLong(r.invoicedAt)}`}
              {r.paidAt && ` · paid ${formatDateLong(r.paidAt)}`}
              {r.note && (
                <div style={{ marginTop: 6, color: 'var(--text)', fontStyle: 'italic' }}>“{r.note}”</div>
              )}
            </div>

            {invoicing === r.id ? (
              <InvoiceForm
                request={r}
                onSent={() => {
                  setInvoicing(null);
                  load();
                }}
                onCancel={() => setInvoicing(null)}
              />
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {r.status === 'pending' && (
                  <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => setInvoicing(r.id)}>
                    Send an invoice
                  </button>
                )}
                {r.status === 'invoiced' && r.invoiceUrl && (
                  <a
                    className="btn btn-ghost"
                    href={r.invoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12.5, textDecoration: 'none' }}
                  >
                    View invoice
                  </a>
                )}
                {(r.status === 'pending' || r.status === 'invoiced') && (
                  <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => dismiss(r)}>
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
