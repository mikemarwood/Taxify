// The rules a plan-change request follows, kept away from the routes so they
// can be tested without Stripe or a database.
//
// The money is the reason this is worth pinning down: a request that can be
// invoiced twice bills somebody twice, and a paid one that can be reopened
// hands out a plan nobody paid for.

export const STATUSES = ['pending', 'invoiced', 'paid', 'cancelled'];

// Which moves are legal. Anything not listed is refused — paid and cancelled
// are both final, and nothing climbs back out of either.
//
// invoiced -> pending is the one backwards move there is, and it exists
// because a wrong invoice had no way out. An invoice for the wrong plan or
// the wrong amount could only be cancelled, which killed the request and left
// the customer to ask again from the start — and left the invoice itself live
// and payable in Stripe. The move is only legal alongside voiding that
// invoice; see /plan-requests/:id/void, which is the only caller.
const ALLOWED = {
  pending: ['invoiced', 'cancelled'],
  invoiced: ['paid', 'cancelled', 'pending'],
  paid: [],
  cancelled: [],
};

export function canTransition(from, to) {
  return Boolean(ALLOWED[from]?.includes(to));
}

// Whether a request is still live is asked in SQL, in billing.routes.js —
// see OUTSTANDING there, which also has to reason about whether the ticket
// behind it is closed. A boolean helper here could not answer that, and
// nothing called it.
export const MAX_INVOICE_AMOUNT = 100000;

// There was an amountProblem here, for an invoice amount an administrator
// typed. They do not type one any more — the figure is Stripe's published
// price for the plan being moved to, so there is nothing left to validate.

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
