import Icon from './Icon.jsx';
import { planLabel } from '../lib/plans.js';
import { formatDateLong } from '../lib/dates.js';

// The plan change this ticket is about, as the person who asked for it sees it.
//
// The invoice was raised inside their ticket and then lived only on the support
// side of it. Their thread said an invoice had been sent and gave them no way
// to open it — which is the one thing they wanted from the conversation.
//
// It sits where the support panel sits: below the messages, above the reply
// box. That is the point in the conversation the invoice belongs to, and it
// means the same thing is in the same place whichever side of the ticket you
// are reading.
//
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

  const plan = planLabel(request.toPlan);
  const amount = money(request.invoiceAmountCents, request.invoiceCurrency);

  // A withdrawn invoice is not shown to the customer at all.
  //
  // The thread already carries a line saying it was taken back and why, which
  // is the part they need. A panel underneath still headed with an amount and
  // a plan reads as a bill however it is labelled, and leaving one on screen
  // for something nobody owes is how a customer ends up asking whether they
  // still have to pay it. Support keeps its own version — they need the
  // history; the customer needs the answer.
  if (request.status === 'cancelled') return null;

  const paid = request.status === 'paid';
  const sent = request.status === 'invoiced';
  // Past its due date and still unpaid. Said here rather than left for somebody
  // to work out by opening the invoice and reading a date on it. A request with
  // no due date was due on receipt, which is not overdue — it is simply now.
  const overdue = sent && request.invoiceDueAt && new Date(request.invoiceDueAt).getTime() < Date.now();

  const state = paid
    ? {
        tone: 'var(--emerald)',
        icon: 'check-circle',
        badge: 'Paid',
        heading: 'Payment received',
        body: [
          amount
            ? `${amount} was received${request.paidAt ? ` on ${formatDateLong(request.paidAt)}` : ''}, with thanks.`
            : `Your payment was received${request.paidAt ? ` on ${formatDateLong(request.paidAt)}` : ''}, with thanks.`,
          `We are moving your account to ${plan} and will confirm here once it is done.`,
          'Your receipt is on your billing page whenever you need it.',
        ],
      }
    : sent
    ? {
        tone: overdue ? 'var(--red)' : 'var(--accent)',
        icon: 'cash',
        badge: overdue ? 'Overdue' : 'Awaiting payment',
        heading: overdue ? 'This invoice is now past its due date' : `Your invoice for ${plan}`,
        body: [
          amount
            ? `${amount} is payable${
                request.invoiceDueAt ? ` by ${formatDateLong(request.invoiceDueAt)}` : ' on receipt'
              }.`
            : 'Your invoice is ready to pay.',
          'Your account stays exactly as it is until it is paid — nothing is charged automatically.',
          overdue
            ? 'It can still be paid using the button below. If something is holding it up, reply here and we will sort it out.'
            : 'Your plan is applied as soon as the payment reaches us.',
        ],
      }
    : {
        tone: 'var(--text-muted)',
        icon: 'clock',
        badge: 'With us',
        heading: `We have your request to move to ${plan}`,
        body: [
          'We are preparing your invoice and it will appear here as soon as it is ready.',
          'Nothing is charged until you choose to pay it.',
        ],
      };

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${state.tone}`,
        borderRadius: 10,
        padding: 14,
        background: 'var(--bg-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Icon name={state.icon} size={16} style={{ color: state.tone }} />
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{state.heading}</span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            padding: '3px 9px',
            borderRadius: 999,
            color: state.tone,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            whiteSpace: 'nowrap',
          }}
        >
          {state.badge}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {state.body.map((line) => (
          <span key={line} style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            {line}
          </span>
        ))}
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
          {amount ? `Pay ${amount}` : 'Open the invoice'}
        </a>
      )}

      {/* Kept reachable after payment too. A receipt is wanted more often than
          an invoice is, and "where did that go" is otherwise a support ticket
          of its own. Not offered on a withdrawn one: the link still opens, and
          it shows a document that no longer means anything. */}
      {paid && request.invoiceUrl && (
        <a
          className="btn btn-ghost"
          href={request.invoiceUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12.5, textDecoration: 'none', alignSelf: 'flex-start' }}
        >
          View your receipt
        </a>
      )}
    </div>
  );
}
