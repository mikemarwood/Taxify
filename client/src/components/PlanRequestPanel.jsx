import { useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { planLabel } from '../lib/plans.js';
import { formatDateLong } from '../lib/dates.js';
import { sentenceCase } from '../lib/text.js';

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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// Due on receipt, or a week, or a fortnight, or a month. Zero is a real answer
// and Stripe treats it as due immediately — it is the one most often wanted,
// so it leads.
const DUE_OPTIONS = [
  { days: 0, label: 'Immediately' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

export default function PlanRequestPanel({ request, onChanged }) {
  const toast = useToast();
  const [description, setDescription] = useState(`Taxify — Change plan to ${planLabel(request.toPlan)}`);
  const [days, setDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // The amount is the plan's own price, read from Stripe by the server. It was
  // a text box, which meant the figure on the invoice and the figure on the
  // plan cards could differ by a keystroke. Nothing about a plan change is
  // negotiable: it costs what the plan costs.
  const priced = Number.isFinite(request.priceCents) && request.priceCents > 0;

  async function send() {
    setBusy(true);
    try {
      await api.post(`/admin/plan-requests/${request.id}/invoice`, {
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
  const withdrawn = request.status === 'cancelled';
  // Past due and still unpaid. No due date means it was due on receipt,
  // which is not overdue.
  const overdue = sent && request.invoiceDueAt && new Date(request.invoiceDueAt).getTime() < Date.now();

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${
          done ? 'var(--emerald)' : overdue ? 'var(--red)' : withdrawn ? 'var(--text-muted)' : sent ? 'var(--text-muted)' : 'var(--accent)'
        }`,
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
            : withdrawn
            ? request.voidedAt
              ? `Withdrawn in Stripe ${formatDateLong(request.voidedAt)}`
              : 'Cancelled'
            : sent
            ? `${money(request.invoiceAmountCents, request.invoiceCurrency)} ${overdue ? 'overdue' : 'invoiced'}${
                request.invoiceDueAt ? ` · due ${formatDateLong(request.invoiceDueAt)}` : ''
              }`
            : 'Not yet invoiced'}
        </span>
      </div>

      {done && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          They have paid. Apply the plan on their account with the dates it should run between — this panel does not
          move it for you.
        </div>
      )}

      {withdrawn && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {request.voidedAt
            ? 'The invoice was voided or written off in Stripe. Nothing is owed and the customer has been told.'
            : 'This request was cancelled. Nothing is owed.'}{' '}
          Raising a new one means a new request — this one is closed.
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
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10 }}>
              <div>
                <label className="label" style={{ fontSize: 11.5 }}>
                  Amount{request.priceCurrency ? ` (${request.priceCurrency})` : ''}
                </label>
                <input
                  className="input"
                  readOnly
                  disabled
                  value={priced ? money(request.priceCents, request.priceCurrency) : 'No price set'}
                  style={{ fontSize: 13, fontWeight: 600 }}
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
                  // Capitalised as they leave the field rather than as they
                  // type: fixing the letter under a moving cursor moves the
                  // cursor, and the field fights whoever is using it.
                  onBlur={() => setDescription(sentenceCase(description))}
                  style={{ fontSize: 13 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Due</span>
              {DUE_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  className={days === option.days ? 'btn btn-primary' : 'btn btn-ghost'}
                  style={{ fontSize: 12, padding: '5px 10px' }}
                  onClick={() => setDays(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {priced
                ? 'Stripe emails the invoice. When it is paid the payment is posted back onto this ticket — the plan itself is applied by hand, with the dates you choose.'
                : 'Stripe has no price for this plan yet, so there is nothing to invoice. Set it on the Stripe tab first.'}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ fontSize: 12.5 }} disabled={!priced || busy} onClick={send}>
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
