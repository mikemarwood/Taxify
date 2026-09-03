// Whether a Stripe event is one of ours.
//
// The problem this exists for: several products share one Stripe account, and
// Stripe delivers every event on an account to every webhook endpoint
// registered against it. So Taxify's endpoint is told about payments made in
// other apps, and until now it wrote them into Taxify's payments table with a
// null user and emailed the administrators to say money had come in. Somebody
// buying something else entirely showed up here as revenue.
//
// The fix is to identify our own events positively rather than to exclude
// strangers, because "unknown customer" is also what a genuine first payment
// looks like for the few seconds before checkout.session.completed writes the
// customer id down. Three signals, any one of which is proof:
//
//   the customer is already a Taxify account
//   the object is stamped with metadata we wrote
//   a line on the invoice is priced with one of our own price ids
//
// None of the three means it is not ours, and the event is dropped.

// Every price id Taxify sells under, from the Stripe settings. Filtered,
// because a product that has not been configured yet is null and null must
// never match an invoice line that is also missing a price.
export function ourPriceIds(config = {}) {
  return [
    config.priceIndividual,
    config.priceBusiness,
    config.priceFamily,
    config.priceIndividualOnce,
    config.priceBusinessOnce,
  ].filter(Boolean);
}

// The price ids on an invoice, across the shapes Stripe has used for them.
//
// `line.price.id` is the current one; `line.plan.id` is what older API
// versions sent and what a subscription line can still carry. Reading both
// costs nothing and means an account on an older API version is not silently
// treated as a stranger.
export function invoicePriceIds(invoice) {
  const lines = invoice?.lines?.data;
  if (!Array.isArray(lines)) return [];
  const ids = [];
  for (const line of lines) {
    const price = typeof line?.price === 'string' ? line.price : line?.price?.id;
    const plan = typeof line?.plan === 'string' ? line.plan : line?.plan?.id;
    const pricing = line?.pricing?.price_details?.price;
    if (price) ids.push(price);
    if (plan && plan !== price) ids.push(plan);
    if (pricing && !ids.includes(pricing)) ids.push(pricing);
  }
  return ids;
}

// { ours, why } — why is kept so the log can say what identified it, which is
// the difference between "we ignored a stranger" and "we ignored a customer"
// when something goes wrong.
export function invoiceIsOurs(invoice, { config = {}, knownCustomer = false } = {}) {
  if (knownCustomer) return { ours: true, why: 'customer' };
  if (invoice?.metadata?.app === 'taxify') return { ours: true, why: 'metadata' };
  if (invoice?.metadata?.planChangeRequestId) return { ours: true, why: 'metadata' };

  const ours = ourPriceIds(config);
  if (ours.length) {
    const onInvoice = invoicePriceIds(invoice);
    if (onInvoice.some((id) => ours.includes(id))) return { ours: true, why: 'price' };
  }
  return { ours: false, why: null };
}
