import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The two advertisement videos on the landing page.
//
// Uploaded rather than deployed. An advertisement is the thing most likely to
// be replaced at short notice — a new one cut for a campaign, an old one that
// says the wrong price — and needing a deploy to swap it means it does not get
// swapped. These live in uploads/ beside the receipts and avatars, so they
// survive a deploy rather than being overwritten by one.
export const AD_SLOTS = ['ad-1', 'ad-2'];

export const adsDir = path.join(__dirname, '..', '..', 'uploads', 'landing');

// Only what a browser will play without a plugin, and only what we can name a
// type for. An upload we cannot label is one the <video> element will refuse.
export const AD_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
};

// The poster is optional and shares the slot name. Without one the browser
// shows the first frame, which is usually black.
export const POSTER_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function isAdSlot(slot) {
  return AD_SLOTS.includes(String(slot));
}

export function ensureAdsDir() {
  if (!fs.existsSync(adsDir)) fs.mkdirSync(adsDir, { recursive: true });
}

// What is actually on disk for a slot, or null.
//
// The extension is discovered rather than assumed: somebody uploads a .webm on
// Tuesday over Monday's .mp4, and the page has to serve what is there, not what
// was there.
function findFile(slot, types) {
  if (!isAdSlot(slot)) return null;
  for (const ext of Object.keys(types)) {
    const file = path.join(adsDir, `${slot}${ext}`);
    if (fs.existsSync(file)) return { file, ext, type: types[ext] };
  }
  return null;
}

export function adFile(slot) {
  return findFile(slot, AD_TYPES);
}

export function posterFile(slot) {
  return findFile(slot, POSTER_TYPES);
}

// Every old file for a slot, whatever its extension. Replacing an .mp4 with a
// .webm has to remove the .mp4, or findFile keeps answering with the old one.
export function clearSlot(slot, types) {
  if (!isAdSlot(slot)) return;
  for (const ext of Object.keys(types)) {
    const file = path.join(adsDir, `${slot}${ext}`);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // A file we cannot remove is not a reason to fail the upload. The new
        // one wins by extension order, and a stale file costs disk, not
        // correctness.
      }
    }
  }
}

// What the landing page needs to know: which slots have something to show.
export function adsPresent() {
  return AD_SLOTS.filter((slot) => adFile(slot) !== null);
}
