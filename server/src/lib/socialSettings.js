import { getSetting, setSetting } from '../db.js';
import { safeHttpUrl } from './landingSocial.js';
import { publicOrigin } from './publicOrigin.js';

// The Facebook settings, read and written in one place.
//
// Separate from landingSocial.js on purpose: that file is pure string work and
// is unit-tested, and importing db.js into it would open a database connection
// the moment a test imported it. This is the half that talks to the settings
// table.

export const SOCIAL_KEYS = {
  enabled: 'facebook_enabled',
  shareUrl: 'facebook_share_url',
  pageUrl: 'facebook_page_url',
};

// What the landing page needs. The share address falls back to the site's own
// public origin, because that is what somebody switching this on almost always
// means and having to type your own address in to share your own page is a
// silly thing to ask.
export async function landingSocialConfig() {
  // On unless somebody has turned it off.
  //
  // This defaulted to off, so the buttons were built, shipped, deployed and
  // invisible — and nothing on the page explained why, because the server
  // removes the block entirely rather than leaving an empty row. The share
  // link needs no configuration at all: the address falls back to this site's
  // own origin. A feature that works out of the box should be out of the box.
  //
  // Same shape as registration_enabled, which is also on until switched off.
  const enabled = (await getSetting(SOCIAL_KEYS.enabled)) !== 'false';
  if (!enabled) return { enabled: false };
  const configured = await getSetting(SOCIAL_KEYS.shareUrl);
  return {
    enabled: true,
    shareUrl: safeHttpUrl(configured) || safeHttpUrl(publicOrigin()) || null,
    pageUrl: await getSetting(SOCIAL_KEYS.pageUrl),
  };
}

// What the admin panel shows. The raw stored values, not the resolved ones —
// an empty box that falls back to the site address is clearer than one
// pre-filled with an address nobody typed.
export async function readSocialSettings() {
  return {
    // Must match landingSocialConfig, or the admin screen shows the switch off
    // while the buttons are on the page.
    facebookEnabled: (await getSetting(SOCIAL_KEYS.enabled)) !== 'false',
    facebookShareUrl: (await getSetting(SOCIAL_KEYS.shareUrl)) || '',
    facebookPageUrl: (await getSetting(SOCIAL_KEYS.pageUrl)) || '',
    // Shown beside the empty share box so it is obvious what it will use.
    defaultShareUrl: publicOrigin() || '',
  };
}

// Returns an error message, or null when everything was written. Addresses are
// checked before they are stored rather than only before they are rendered:
// something that cannot be used is better refused at the point somebody typed
// it than silently dropped later.
export async function writeSocialSettings(body) {
  const { facebookEnabled, facebookShareUrl, facebookPageUrl } = body || {};

  if (facebookEnabled !== undefined) {
    if (typeof facebookEnabled !== 'boolean') return 'facebookEnabled must be a boolean';
  }

  for (const [field, value, label] of [
    ['shareUrl', facebookShareUrl, 'The share address'],
    ['pageUrl', facebookPageUrl, 'The Facebook page address'],
  ]) {
    if (value === undefined) continue;
    const text = String(value).trim();
    // Empty clears it. Anything else has to be a real http(s) address, because
    // it ends up in an href and an iframe src on a public page.
    if (text && !safeHttpUrl(text)) return `${label} must be a full http:// or https:// address`;
    await setSetting(SOCIAL_KEYS[field], text);
  }

  if (facebookEnabled !== undefined) {
    await setSetting(SOCIAL_KEYS.enabled, facebookEnabled ? 'true' : 'false');
  }
  return null;
}
