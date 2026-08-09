import Icon from './Icon.jsx';
import { planLabel } from '../lib/plans.js';
import { formatDateLong } from '../lib/dates.js';

// The plan change this ticket is about, as the person who asked for it sees it.
//
// The invoice was raised inside their ticket and then lived only on the support
// side of it. Their own thread said an invoice had been sent and gave them no
// way to open it — which is the one thing they wanted from the conversation.
// The state is read from the same row the support panel reads, so the two sides
// cannot say different things about the same invoice.
function money(cents, currency) {
  if (cents == null) return null;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'AUD').toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default function PlanInvoiceNotice({ request }) {
  if (!request) return null;

  const paid = request.status === 'paid';
  const sent = request.status === 'invoiced';
  const cancelled = request.status === 'cancelled';
  if (cancelled) return null;

  const amount = money(request.invoiceAmountCents, request.invoiceCurrency);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${paid ? 'var(--emerald)' : sent ? 'var(--accent)' : 'var(--text-muted)'}`,
        borderRadius: 10,
        padding: 14,
        background: 'var(--bg-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name="credit-card" size={15} style={{ color: paid ? 'var(--emerald)' : 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>Moving to {planLabel(request.toPlan)}</span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            padding: '3px 9px',
            borderRadius: 999,
            color: paid ? 'var(--emerald)' : sent ? 'var(--accent)' : 'var(--text-muted)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
          }}
        >
          {paid ? 'Paid' : sent ? 'Awaiting payment' : 'With us'}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {paid
          ? `Paid${request.paidAt ? ` on ${formatDateLong(request.paidAt)}` : ''}${
              amount ? ` — ${amount}` : ''
            }. We are moving you across; you will see the new plan on your account shortly.`
          : sent
          ? `${amount ? `${amount} is ` : 'An invoice is '}waiting to be paid${
              request.invoicedAt ? `, sent ${formatDateLong(request.invoicedAt)}` : ''
            }. Your plan moves once the payment clears — nothing changes before then.`
          : 'We have your request and will send you an invoice. Nothing is charged until you pay it.'}
      </div>

      {sent && request.invoiceUrl && (
        <a
          className="btn btn-primary"
          href={request.invoiceUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12.5, textDecoration: 'none', alignSelf: 'flex-start', gap: 6 }}
        >
          <Icon name="cash" size={13} />
          Open the invoice
        </a>
      )}

      {/* Kept reachable after payment too. A receipt is wanted more often than
          an invoice is, and "where did that go" is otherwise a support ticket
          of its own. */}
      {paid && request.invoiceUrl && (
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
    </div>
  );
}
