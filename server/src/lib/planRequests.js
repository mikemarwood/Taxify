// The rules a plan-change request follows, kept away from the routes so they
// can be tested without Stripe or a database.
//
// The money is the reason this is worth pinning down: a request that can be
// invoiced twice bills somebody twice, and a paid one that can be reopened
// hands out a plan nobody paid for.

export const STATUSES = ['pending', 'invoiced', 'paid', 'cancelled'];

// Which moves are legal. Anything not listed is refused — including every
// backwards move, because paid and cancelled are both final.
const ALLOWED = {
  pending: ['invoiced', 'cancelled'],
  invoiced: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

export function canTransition(from, to) {
  return Boolean(ALLOWED[from]?.includes(to));
}

// Still waiting on somebody. Used to stop a second request being opened while
// one is live — two invoices for the same move is the worst outcome here.
export function isOpen(status) {
  return status === 'pending' || status === 'invoiced';
}

export const MAX_INVOICE_AMOUNT = 100000;

// Returns a message, or '' when the amount is fine.
export function amountProblem(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Enter the amount to charge';
  if (amount <= 0) return 'Enter the amount to charge';
  // Stripe works in cents, so anything finer than one is silently rounded and
  // the invoice would not say what was typed.
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(4))) {
    return 'Amounts can have at most two decimal places';
  }
  if (amount > MAX_INVOICE_AMOUNT) return 'That amount is too large';
  return '';
}

// Whether a Stripe invoice.paid event should be acted on.
//
// Stripe retries a webhook until it gets a 2xx, so the same payment arrives
// more than once. Renewals are invoices too, and carry no request id — without
// that check every renewal would be looked up and found missing.
export function shouldApplyPayment({ requestId, request }) {
  if (!requestId) return { apply: false, reason: 'not_a_plan_change' };
  if (!request) return { apply: false, reason: 'unknown_request' };
  if (request.status === 'paid') return { apply: false, reason: 'already_applied' };
  if (request.status === 'cancelled') {
    // Paid after cancelling: the money is real, so it must not be silently
    // kept and it must not silently grant the plan either.
    return { apply: false, reason: 'cancelled_but_paid' };
  }
  return { apply: true, reason: 'ok' };
}
