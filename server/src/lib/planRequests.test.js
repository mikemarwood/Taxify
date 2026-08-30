import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  shouldApplyPayment,
  MAX_INVOICE_AMOUNT,
} from './planRequests.js';

test('a request can be invoiced once, and paid once', () => {
  assert.equal(canTransition('pending', 'invoiced'), true);
  assert.equal(canTransition('invoiced', 'paid'), true);
});

test('an invoiced request cannot be invoiced again', () => {
  // Two invoices for one plan change bills somebody twice, which is the worst
  // thing this feature could do.
  assert.equal(canTransition('invoiced', 'invoiced'), false);
});

test('paid and cancelled are final', () => {
  assert.equal(canTransition('paid', 'invoiced'), false);
  assert.equal(canTransition('paid', 'cancelled'), false);
  assert.equal(canTransition('cancelled', 'invoiced'), false);
  assert.equal(canTransition('cancelled', 'paid'), false);
});

test('the same payment arriving twice is applied once', () => {
  // Stripe retries until it gets a 2xx, so this event is delivered more than
  // once for a single payment. Applying it twice would move the plan again and
  // notify everybody again.
  const paid = { status: 'paid' };
  assert.deepEqual(shouldApplyPayment({ requestId: 5, request: paid }), {
    apply: false,
    reason: 'already_applied',
  });
});

test('a subscription renewal is not mistaken for a plan change', () => {
  // Renewals are invoices too and carry no request id in their metadata.
  assert.equal(shouldApplyPayment({ requestId: 0, request: null }).apply, false);
  assert.equal(shouldApplyPayment({ requestId: 0, request: null }).reason, 'not_a_plan_change');
});

test('a payment against a cancelled request does not quietly grant the plan', () => {
  const result = shouldApplyPayment({ requestId: 5, request: { status: 'cancelled' } });
  assert.equal(result.apply, false);
  assert.equal(result.reason, 'cancelled_but_paid');
});

test('a first payment is applied', () => {
  assert.equal(shouldApplyPayment({ requestId: 5, request: { status: 'invoiced' } }).apply, true);
});

