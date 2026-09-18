import test from 'node:test';
import assert from 'node:assert/strict';
import { injectLandingHead, taxifyHeadHtml } from './landingHead.js';

// What the hub actually serves, trimmed to the tags this replaces. Copied from
// the live page rather than invented, because the point of this module is to
// beat those specific tags and a fixture that does not look like them proves
// nothing.
const HUB_PAGE = `<!doctype html><html><head>
<title>Taxify — Mikes App Hub</title>
<meta name="description" content="Easily Keep Track Of Receipts And Expenses By Category.">
<link rel="canonical" href="https://mikesapphub.com/apps/taxify">
<link rel="icon" type="image/svg+xml" href="https://mikesapphub.com/favicon.svg">
<link rel="icon" type="image/png" href="https://mikesapphub.com/favicon.png">
<link rel="apple-touch-icon" href="https://mikesapphub.com/logo-192.png">
<meta property="og:title" content="Taxify — Mikes App Hub">
<meta property="og:url" content="https://mikesapphub.com/apps/taxify">
<meta property="og:image" content="https://mikesapphub.com/uploads/icons/product-7.png">
<meta name="twitter:title" content="Taxify — Mikes App Hub">
<meta name="twitter:image" content="https://mikesapphub.com/uploads/icons/product-7.png">
<script type="application/ld+json">{"@type":"SoftwareApplication","url":"https://mikesapphub.com/apps/taxify"}</script>
</head><body><main>Taxify</main></body></html>`;

test('the canonical points here, not at the hub', () => {
  // The one that matters most. Left as the hub's, taxify.net.au — the address
  // on the advertisements — asks to be treated as a duplicate of somewhere
  // else, and the hub's copy is what gets indexed.
  const out = injectLandingHead(HUB_PAGE);
  assert.ok(!out.includes('rel="canonical" href="https://mikesapphub.com/apps/taxify"'));
  assert.match(out, /<link rel="canonical" href="https:\/\/taxify\.net\.au\/">/);
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
});

test('the icons are ours', () => {
  const out = injectLandingHead(HUB_PAGE);
  assert.ok(!out.includes('mikesapphub.com/favicon.svg'));
  assert.ok(!out.includes('mikesapphub.com/favicon.png'));
  assert.ok(!out.includes('mikesapphub.com/logo-192.png'));
  assert.match(out, /href="https:\/\/taxify\.net\.au\/favicon\.svg"/);
});

test('the title is ours and there is only one', () => {
  const out = injectLandingHead(HUB_PAGE);
  assert.ok(!out.includes('<title>Taxify — Mikes App Hub</title>'));
  // &amp;, because a bare ampersand in a title is not valid HTML.
  assert.ok(out.includes('<title>Receipt &amp; expense tracker for Australian tax time | Taxify</title>'));
  assert.equal((out.match(/<title>/g) || []).length, 1);
});

test('the share card is ours, for scrapers that never run a script', () => {
  // Facebook and LinkedIn do not execute JavaScript, so this is the only place
  // these can be fixed — the injected script cannot reach them.
  const out = injectLandingHead(HUB_PAGE);
  assert.ok(!out.includes('content="Taxify — Mikes App Hub"'));
  assert.match(out, /property="og:title" content="Tax receipts\. Sorted\."/);
  assert.match(out, /property="og:url" content="https:\/\/taxify\.net\.au\/"/);
  assert.ok(!out.includes('uploads/icons/product-7.png'));
  assert.equal((out.match(/property="og:title"/g) || []).length, 1);
  assert.equal((out.match(/name="twitter:title"/g) || []).length, 1);
});

test('one description, and it is the one about this app', () => {
  const out = injectLandingHead(HUB_PAGE);
  assert.ok(!out.includes('Easily Keep Track Of Receipts And Expenses By Category.'));
  assert.equal((out.match(/name="description"/g) || []).length, 1);
});

test('the structured data is valid JSON and names this address', () => {
  const out = injectLandingHead(HUB_PAGE);
  const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(out);
  assert.ok(block, 'structured data should be present');
  const data = JSON.parse(block[1]);
  assert.equal(data.url, 'https://taxify.net.au/');
  assert.equal(data['@type'], 'SoftwareApplication');
});

test('the hub’s description of the app goes, so only one survives', () => {
  // Two SoftwareApplication entries disagreeing about where the application
  // lives is worse than either alone — which one is believed is the crawler's
  // choice, and not making it guess is half the point of the canonical.
  const out = injectLandingHead(HUB_PAGE);
  assert.equal((out.match(/application\/ld\+json/g) || []).length, 1);
  assert.ok(!out.includes('mikesapphub.com/apps/taxify'));
});

test('it goes in once, however many times the page is served', () => {
  const once = injectLandingHead(HUB_PAGE);
  assert.equal(injectLandingHead(once), once);
});

test('everything ours lands before the head closes', () => {
  const out = injectLandingHead(HUB_PAGE);
  assert.ok(out.indexOf('rel="canonical" href="https://taxify.net.au/"') < out.indexOf('</head>'));
});

test('a page with no head is left exactly as it came', () => {
  // This runs on markup somebody else assembled. A page whose shape cannot be
  // read is a page to leave alone rather than guess at.
  const plain = '<html><body>nothing to do here</body></html>';
  assert.equal(injectLandingHead(plain), plain);
  assert.equal(injectLandingHead(''), '');
  assert.equal(injectLandingHead(null), '');
});

test('the head block escapes what it writes into an attribute', () => {
  const html = taxifyHeadHtml();
  assert.ok(!/content="[^"]*"[^">]*"/.test(html), 'no attribute should be closed early');
});
