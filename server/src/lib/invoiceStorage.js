import fs from 'fs';
import path from 'path';
import { userRootDir } from './receiptStorage.js';

// Where a customer's own billing paperwork lives, and what it is called.
//
// Beside receipts under the same per-user root, not mixed in with them: a tax
// invoice from us is not a business expense record, and an export of "all my
// receipts" should not sweep up our invoices.

export const INVOICES_SEGMENT = 'invoices';

export function invoicesDir(uploadsRoot, userId) {
  return path.join(userRootDir(uploadsRoot, userId), INVOICES_SEGMENT);
}

// Named so a folder of them sorts by date and reads without being opened.
// Stripe's own number is kept because that is what appears on the document and
// what somebody would quote to us.
export function invoiceFilename(invoice) {
  const number = String(invoice?.number || invoice?.id || 'invoice')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const date = invoiceDateString(invoice);
  return `taxify-${date}-${number}.pdf`;
}

// yyyy-mm-dd from Stripe's seconds. Falls back to the epoch date rather than
// to "undefined" in a filename.
export function invoiceDateString(invoice) {
  const seconds = invoice?.created;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : 0;
  return new Date(ms).toISOString().slice(0, 10);
}

// Only what the account page needs, and nothing that identifies the card.
export function shapeInvoice(invoice, { stored = false } = {}) {
  return {
    id: invoice.id,
    number: invoice.number || null,
    status: invoice.status || 'draft',
    // Stripe reports amounts in the currency's smallest unit.
    amountDue: invoice.amount_due ?? 0,
    amountPaid: invoice.amount_paid ?? 0,
    currency: (invoice.currency || 'aud').toUpperCase(),
    created: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
    periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    description: invoice.lines?.data?.[0]?.description || null,
    // Stripe's own hosted copy, which stays available even if our cache is
    // cleared. The PDF itself is served from us so it needs no Stripe session.
    hostedUrl: invoice.hosted_invoice_url || null,
    filename: invoiceFilename(invoice),
    stored,
  };
}

// True once the PDF is on disk. Checked rather than assumed, because a file
// can be removed underneath us and the answer must reflect what is actually
// there.
export function isStored(uploadsRoot, userId, invoice) {
  try {
    return fs.existsSync(path.join(invoicesDir(uploadsRoot, userId), invoiceFilename(invoice)));
  } catch {
    return false;
  }
}

// Downloads the PDF once and keeps it.
//
// Written to a temporary name and renamed into place, so an interrupted
// download can never leave a half-written PDF that looks complete. Returns the
// path, or null when Stripe has not produced a PDF for this invoice yet —
// which is normal for a draft.
export async function storeInvoicePdf(uploadsRoot, userId, invoice) {
  if (!invoice?.invoice_pdf) return null;

  const dir = invoicesDir(uploadsRoot, userId);
  const target = path.join(dir, invoiceFilename(invoice));
  if (fs.existsSync(target)) return target;

  fs.mkdirSync(dir, { recursive: true });

  const res = await fetch(invoice.invoice_pdf);
  if (!res.ok) throw new Error(`Stripe returned HTTP ${res.status} for invoice ${invoice.id}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const temp = `${target}.part`;
  try {
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, target);
  } catch (err) {
    try {
      fs.unlinkSync(temp);
    } catch {
      // Nothing to clean up.
    }
    throw err;
  }
  return target;
}
