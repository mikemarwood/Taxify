import { useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { parseAmount, amountWhileTyping, amountOnBlur } from '../lib/money.js';
import { useToast } from './Toast.jsx';
import { planLabel } from '../lib/plans.js';
import { formatDateLong } from '../lib/dates.js';

// The plan change a ticket is about, handled inside the conversation.
//
// This used to be its own admin tab. Two places to look means one of them gets
// forgotten, and the two halves of the job — agreeing the price with somebody
// and charging them for it — belong in the same thread as the question that
// started them.
function money(cents, currency) {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'AUD').toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export default function PlanRequestPanel({ request, onChanged }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState(`Taxify — change to the ${planLabel(request.toPlan)} plan`);
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const value = parseAmount(amount) ?? NaN;
  const valid = Number.isFinite(value) && value > 0 && value <= 100000;

  async function send() {
    setBusy(true);
    try {
      await api.post(`/admin/plan-requests/${request.id}/invoice`, {
        amount: value,
        description: description.trim(),
        daysUntilDue: days,
      });
      toast('Invoice sent', 'success');
      setOpen(false);
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const done = request.status === 'paid';
  const sent = request.status === 'invoiced';

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${done ? 'var(--emerald)' : sent ? 'var(--accent)' : 'var(--amber)'}`,
        borderRadius: 10,
        padding: 14,
        background: 'var(--bg-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name="credit-card" size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          Plan change · {planLabel(request.fromPlan)} → {planLabel(request.toPlan)}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {done
            ? `Paid ${formatDateLong(request.paidAt)}`
            : sent
            ? `${money(request.invoiceAmountCents, request.invoiceCurrency)} invoiced`
            : 'Not yet invoiced'}
        </span>
      </div>

      {done && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          The plan moved across automatically when Stripe confirmed the payment.
        </div>
      )}

      {sent && request.invoiceUrl && (
        <a
          className="btn btn-ghost"
          href={request.invoiceUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12.5, textDecoration: 'none', alignSelf: 'flex-start' }}
        >
          View the invoice
        </a>
      )}

      {request.status === 'pending' &&
        (open ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
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
              Stripe emails the invoice. Their plan moves when Stripe confirms it is paid — not before, and nothing here
              charges a card.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ fontSize: 12.5 }} disabled={!valid || busy} onClick={send}>
                {busy && <span className="spinner" />}
                Send invoice
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-primary"
            style={{ fontSize: 12.5, alignSelf: 'flex-start' }}
            onClick={() => setOpen(true)}
          >
            Send an invoice
          </button>
        ))}
    </div>
  );
}
