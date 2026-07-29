import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import convert from 'heic-convert';

// iPhones shoot HEIC by default, and no desktop browser can decode it — the
// file uploads and downloads fine but shows as a broken image or a "can't
// preview" placeholder, which makes a receipt you can't read. Converting to
// JPEG on the way out fixes that without touching the original: the stored
// receipt stays the HEIC that came off the phone, and downloads still hand
// back that exact file.
//
// Conversion is pure JS (libheif compiled to wasm), so there's no system
// package to install on the host — but it is slow enough that the result has
// to be cached, and slow enough that a grid of them needs a queue.

const CACHE_DIR_NAME = '.cache';
const MAX_CONCURRENT = 2;

let running = 0;
const queue = [];
const inFlight = new Map();

export function isHeic(filename) {
  return /\.(heic|heif)$/i.test(filename || '');
}

// Sits outside the per-user receipt folders on purpose: anything inside them
// gets listed in the inbox and the gallery, and a cached "img-5707.jpg" beside
// "img-5707.heic" would look like a second receipt.
function cachePathFor(uploadsRoot, absPath, stat) {
  const key = crypto
    .createHash('sha1')
    .update(`${absPath}:${stat.mtimeMs}:${stat.size}`)
    .digest('hex');
  return path.join(uploadsRoot, CACHE_DIR_NAME, 'preview', `${key}.jpg`);
}

function runQueued(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
}

function drain() {
  if (running >= MAX_CONCURRENT || queue.length === 0) return;
  const { task, resolve, reject } = queue.shift();
  running++;
  task()
    .then(resolve, reject)
    .finally(() => {
      running--;
      drain();
    });
}

// Returns a path to a browser-renderable copy, or null if this file doesn't
// need one or couldn't be converted. Null means "send the original" — a
// failed conversion should degrade to the old behaviour, not to an error.
export async function viewableCopy(uploadsRoot, absPath) {
  if (!isHeic(absPath)) return null;

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }

  // Keyed on mtime and size, so replacing a receipt in place invalidates the
  // cached preview rather than serving the previous image.
  const cachePath = cachePathFor(uploadsRoot, absPath, stat);
  if (fs.existsSync(cachePath)) return cachePath;

  // Two requests for the same receipt arrive together whenever a grid renders;
  // without this they'd both decode the same file.
  if (inFlight.has(cachePath)) return inFlight.get(cachePath);

  const job = runQueued(async () => {
    const jpeg = await convert({
      buffer: await fs.promises.readFile(absPath),
      format: 'JPEG',
      quality: 0.82,
    });
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    // Written alongside then renamed, so a crash mid-write can't leave a
    // truncated file that later looks like a valid cache hit.
    const temp = `${cachePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, Buffer.from(jpeg));
    await fs.promises.rename(temp, cachePath);
    return cachePath;
  })
    .catch((err) => {
      console.error(`Failed to convert HEIC for preview: ${absPath}`, err.message);
      return null;
    })
    .finally(() => inFlight.delete(cachePath));

  inFlight.set(cachePath, job);
  return job;
}
