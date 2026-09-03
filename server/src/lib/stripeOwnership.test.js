import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceIsOurs, invoicePriceIds, ourPriceIds } from './stripeOwnership.js';

const CONFIG = {
  priceIndividual: 'price_ind',
  priceBusiness: 'price_biz',
  priceFamily: null,
  priceIndividualOnce: 'price_ind_once',
  priceBusinessOnce: null,
};

test('only configured prices count as ours', () => {
  assert.deepEqual(ourPriceIds(CONFIG), ['price_ind', 'price_biz', 'price_ind_once']);
  // The whole point of the filter: an unconfigured product is null, and a null
  // must never match an invoice line that also has no price.
  assert.deepEqual(ourPriceIds({}), []);
});

test('price ids are read whichever shape Stripe sent', () => {
  assert.deepEqual(invoicePriceIds({ lines: { data: [{ price: { id: 'price_ind' } }] } }), ['price_ind']);
  assert.deepEqual(invoicePriceIds({ lines: { data: [{ price: 'price_biz' }] } }), ['price_biz']);
  // Older API versions send plan rather than price on a subscription line.
  assert.deepEqual(invoicePriceIds({ lines: { data: [{ plan: { id: 'price_ind' } }] } }), ['price_ind']);
  assert.deepEqual(invoicePriceIds({}), []);
  assert.deepEqual(invoicePriceIds(null), []);
});

test("another app's payment on the same Stripe account is not ours", () => {
  // The case that started this: one Stripe account, several products, and
  // every event delivered to every endpoint. This invoice is a real payment —
  // for something else.
  const theirs = {
    id: 'in_other',
    amount_paid: 100,
    lines: { data: [{ price: { id: 'price_some_other_app' } }] },
  };
  assert.equal(invoiceIsOurs(theirs, { config: CONFIG, knownCustomer: false }).ours, false);
});

test('a payment is ours if any one of the three signals says so', () => {
  const bare = { id: 'in_1', lines: { data: [{ price: { id: 'price_unknown' } }] } };

  // The customer is already on an account here.
  assert.deepEqual(invoiceIsOurs(bare, { config: CONFIG, knownCustomer: true }), { ours: true, why: 'customer' });

  // An invoice we raised ourselves for a plan change carries our own id, and
  // is ours even before the customer has been linked.
  assert.equal(
    invoiceIsOurs({ ...bare, metadata: { planChangeRequestId: '12' } }, { config: CONFIG }).why,
    'metadata'
  );

  // A first subscription payment, where the price is ours but the customer id
  // has not been written to the account yet. This is why the test is not
  // simply "is the customer known" — that race would drop real money.
  assert.equal(
    invoiceIsOurs({ id: 'in_2', lines: { data: [{ price: { id: 'price_biz' } }] } }, { config: CONFIG }).why,
    'price'
  );
});

test('nothing is claimed when Stripe is not configured', () => {
  // No price ids on file means the price signal cannot speak, and a strange
  // customer must not be adopted on the strength of silence.
  const invoice = { id: 'in_3', lines: { data: [{ price: { id: 'price_ind' } }] } };
  assert.equal(invoiceIsOurs(invoice, { config: {} }).ours, false);
  // The customer signal still works, because it does not depend on settings.
  assert.equal(invoiceIsOurs(invoice, { config: {}, knownCustomer: true }).ours, true);
});
