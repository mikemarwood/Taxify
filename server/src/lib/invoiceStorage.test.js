import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { invoicesDir, invoiceFilename, invoiceDateString, shapeInvoice } from './invoiceStorage.js';

const ROOT = path.join('/tmp', 'uploads');

test('invoices sit beside receipts, not among them', () => {
  const dir = invoicesDir(ROOT, 42);
  assert.ok(dir.includes(path.join('42', 'invoices')), dir);
  // An export of "all my receipts" walks the receipts folder. Our own billing
  // paperwork must not be swept into it.
  assert.ok(!dir.includes('receipts'), dir);
});

test('a bad user id cannot walk out of uploads', () => {
  // The property that matters is containment, not the absence of dots. The
  // sanitiser flattens "../../etc" to one literal folder name, which is a
  // perfectly safe thing to be left with — it resolves inside uploads.
  for (const nasty of ['../../etc', '..', '../..', 'a/../../b', '\\\\server\\share']) {
    const dir = path.resolve(invoicesDir(ROOT, nasty));
    assert.ok(
      dir.startsWith(path.resolve(ROOT) + path.sep),
      `${JSON.stringify(nasty)} escaped to ${dir}`
    );
  }
});

test('filenames sort by date and read without opening', () => {
  const invoice = { number: 'ABC-0001', created: 1767225600 }; // 2026-01-01
  assert.equal(invoiceFilename(invoice), 'taxify-2026-01-01-ABC-0001.pdf');
});

test('a filename never carries a path separator or a stray character', () => {
  const nasty = { number: '../../etc/passwd', created: 1767225600 };
  const name = invoiceFilename(nasty);
  assert.ok(!name.includes('/'), name);
  assert.ok(!name.includes('\\'), name);
  assert.ok(!name.includes('..'), name);
  assert.match(name, /^taxify-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9-]+\.pdf$/);
});

test('a missing number falls back to the id, and a missing date to the epoch', () => {
  assert.equal(invoiceFilename({ id: 'in_123' }), 'taxify-1970-01-01-in_123.pdf'.replace('in_123', 'in-123'));
  assert.equal(invoiceDateString({}), '1970-01-01');
  assert.equal(invoiceDateString({ created: 'nonsense' }), '1970-01-01');
});

test('the shape carries money as Stripe gives it, and nothing about the card', () => {
  const shaped = shapeInvoice({
    id: 'in_1',
    number: 'T-0001',
    status: 'paid',
    amount_due: 14900,
    amount_paid: 14900,
    currency: 'aud',
    created: 1767225600,
    hosted_invoice_url: 'https://stripe.example/i/1',
    invoice_pdf: 'https://stripe.example/i/1.pdf',
    lines: { data: [{ description: 'Small Business' }] },
    // Anything not asked for must not come through.
    customer_email: 'someone@example.com',
    payment_intent: 'pi_secret',
  });

  assert.equal(shaped.amountDue, 14900);
  assert.equal(shaped.currency, 'AUD');
  assert.equal(shaped.description, 'Small Business');
  assert.equal(shaped.created, '2026-01-01T00:00:00.000Z');
  assert.equal(shaped.stored, false);

  // The PDF is served from us, so its Stripe URL must not be handed out.
  assert.equal(shaped.invoice_pdf, undefined);
  assert.equal(shaped.customer_email, undefined);
  assert.equal(shaped.payment_intent, undefined);
});

test('an invoice with no lines still shapes', () => {
  const shaped = shapeInvoice({ id: 'in_2', currency: 'aud' });
  assert.equal(shaped.description, null);
  assert.equal(shaped.amountDue, 0);
  assert.equal(shaped.status, 'draft');
});
