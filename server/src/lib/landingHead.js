// The landing page's own head, put back after the hub has replaced it.
//
// The share image is its own file, not the hero. The hero is transparent, and
// Facebook and LinkedIn flatten transparency against whatever they please —
// usually black — then crop to roughly 1.91:1. share-card.jpg is the same
// picture composited on the hero's navy at 1200x630, which is the shape they
// were going to cut anyway.
//
// A real visitor is served the hub's copy of this page, and the hub does not
// merely wrap it — it rewrites the head. Measured against the live page rather
// than assumed, everything below was the hub's:
//
//   <title>                 Taxify — Mikes App Hub
//   <link rel="canonical">  https://mikesapphub.com/apps/taxify
//   <link rel="icon">       https://mikesapphub.com/favicon.svg
//   og:title / og:image     the hub's name and the hub's picture
//   description             the hub's one-liner for every app it hosts
//
// The canonical is the one that matters most. It tells Google the page worth
// indexing lives on mikesapphub.com, so taxify.net.au — the address on the
// advertisements — was asking to be treated as a duplicate of somewhere else.
//
// Done here rather than in the injected script for one reason: Facebook,
// LinkedIn and the rest do not run JavaScript. A title fixed in the DOM is
// fixed for Google, which renders, and not for the scraper that builds the card
// somebody sees when the link is shared. This runs on the HTML before it is
// sent, so it is fixed for both.

const ORIGIN = 'https://taxify.net.au';

const TITLE = 'Receipt & expense tracker for Australian tax time | Taxify';

const DESCRIPTION =
  'Photograph a receipt and Taxify files it — right category, right tax year. Work, business and rental ' +
  'expenses organised and ready for tax time. Built in Australia. 14-day free trial, no credit card required.';

const SHARE_TITLE = 'Tax receipts. Sorted.';

const SHARE_DESCRIPTION =
  'Photograph a receipt and Taxify files it — right category, right tax year. Come tax time the whole year ' +
  'is already added up. 14-day free trial, no card needed.';

const MARKER = '<!--TAXIFY-HEAD-->';

// Everything the hub writes that we are replacing. Each is removed before ours
// goes in, because two canonicals or two og:titles is worse than either one:
// which of them wins is the crawler's choice, not ours.
const REPLACED = [
  /<title>[\s\S]*?<\/title>/gi,
  /<link\b[^>]*rel=(["'])[^"']*\bcanonical\b[^"']*\1[^>]*>/gi,
  /<link\b[^>]*rel=(["'])[^"']*\bicon\b[^"']*\1[^>]*>/gi,
  /<meta\b[^>]*name=(["'])description\1[^>]*>/gi,
  /<meta\b[^>]*property=(["'])og:[a-z:]+\1[^>]*>/gi,
  /<meta\b[^>]*name=(["'])twitter:[a-z:]+\1[^>]*>/gi,
  // The hub describes the app too, and its block names mikesapphub.com as the
  // url. Two SoftwareApplication entries on one page disagreeing about where
  // the application lives is worse than either alone: which one a search
  // engine believes is its own choice, and half the point of a canonical is to
  // stop making it guess.
  /<script\b[^>]*type=([\"'])application\/ld\+json\1[^>]*>[\s\S]*?<\/script>/gi,
];

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The structured data a search result is built from. Kept beside the tags it
// belongs with rather than in the file, where the hub was throwing it away
// along with everything else.
function structuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Taxify',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web, Android',
    url: `${ORIGIN}/`,
    description: DESCRIPTION,
    image: `${ORIGIN}/media/share-card.jpg`,
    inLanguage: 'en-AU',
    publisher: { '@type': 'Organization', name: 'Mikes App Hub', url: 'https://mikesapphub.com' },
    offers: [
      { '@type': 'Offer', name: 'Individual', price: '49', priceCurrency: 'AUD', category: 'Subscription' },
      { '@type': 'Offer', name: 'Small Business', price: '99', priceCurrency: 'AUD', category: 'Subscription' },
    ],
  };
}

export function taxifyHeadHtml() {
  const meta = (attr, name, content) =>
    `<meta ${attr}="${name}" content="${escapeAttribute(content)}">`;

  return (
    MARKER +
    `<title>${escapeAttribute(TITLE)}</title>` +
    meta('name', 'description', DESCRIPTION) +
    // This page, not the hub's copy of it. Everything points at the address on
    // the advertisements.
    `<link rel="canonical" href="${ORIGIN}/">` +
    meta('name', 'robots', 'index, follow, max-image-preview:large') +
    `<link rel="icon" type="image/svg+xml" href="${ORIGIN}/favicon.svg">` +
    `<link rel="icon" type="image/png" sizes="32x32" href="${ORIGIN}/favicon-32.png">` +
    `<link rel="apple-touch-icon" sizes="180x180" href="${ORIGIN}/apple-touch-icon.png">` +
    meta('property', 'og:type', 'website') +
    meta('property', 'og:site_name', 'Taxify') +
    meta('property', 'og:url', `${ORIGIN}/`) +
    meta('property', 'og:title', SHARE_TITLE) +
    meta('property', 'og:description', SHARE_DESCRIPTION) +
    meta('property', 'og:image', `${ORIGIN}/media/share-card.jpg`) +
    meta('property', 'og:image:width', '1200') +
    meta('property', 'og:image:height', '630') +
    meta('property', 'og:image:alt', 'A receipt being photographed, and the same purchase already filed in Taxify') +
    meta('property', 'og:locale', 'en_AU') +
    meta('name', 'twitter:card', 'summary_large_image') +
    meta('name', 'twitter:title', SHARE_TITLE) +
    meta('name', 'twitter:description', SHARE_DESCRIPTION) +
    meta('name', 'twitter:image', `${ORIGIN}/media/share-card.jpg`) +
    `<script type="application/ld+json">${JSON.stringify(structuredData())}</script>`
  );
}

// Strips what the hub wrote and puts ours in its place, immediately before the
// head closes so nothing it writes later can win on document order.
//
// A page with no </head> is returned untouched rather than guessed at: this
// runs on markup somebody else assembled, and a page we cannot read the shape
// of is a page to leave alone.
export function injectLandingHead(html) {
  const source = String(html || '');
  if (!source || source.includes(MARKER)) return source;

  const close = source.toLowerCase().indexOf('</head>');
  if (close === -1) return source;

  let head = source.slice(0, close);
  const rest = source.slice(close);
  for (const pattern of REPLACED) head = head.replace(pattern, '');

  return head + taxifyHeadHtml() + rest;
}
