// What the APK on disk will say about itself once it is installed.
//
// The update banner compares two numbers: the one the running app puts in its
// user agent, and the one this server advertises as available. When the second
// is larger, it offers an update. So if the server advertises a build the
// download cannot actually produce, tapping update installs the same APK, the
// app reports the same number again, and the banner comes straight back. An
// endless loop, and the person is doing exactly what they were asked to.
//
// That has now happened twice. Both times the cause was the same: the three
// source files were bumped and the APK was not rebuilt, so the marker baked
// into the shipped artefact stayed behind. A file saying which build exists is
// a promise about a different file, and nothing was checking the promise.
//
// The APK is a zip, and Capacitor writes the marker into
// assets/capacitor.config.json inside it — the same string the WebView appends
// to its user agent at runtime. Reading it here means the advertised number is
// taken from the thing being downloaded rather than from a note about it, and
// the two cannot drift apart again.

import fs from 'fs';
import zlib from 'zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const CONFIG_ENTRY = 'assets/capacitor.config.json';

// The end-of-central-directory record, scanning back from the end. It is the
// last thing in the file except for an optional comment, which is capped at
// 64KB — so that is as far back as this ever has to look.
function findEndOfCentralDirectory(buf) {
  const earliest = Math.max(0, buf.length - 66 * 1024);
  for (let at = buf.length - 22; at >= earliest; at -= 1) {
    if (buf.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

// One named entry, decompressed, or null if it is not there or the zip is not
// one this can read. Deliberately small: it reads a single known file out of a
// file we produced ourselves, and everything unusual is a null rather than a
// throw, because no version banner is a better outcome than a crashed route.
export function readZipEntry(buf, wanted) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;

  const eocd = findEndOfCentralDirectory(buf);
  if (eocd === -1) return null;

  const entries = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < entries; i += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL_SIGNATURE) return null;

    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localHeader = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);

    if (name === wanted) {
      // The local header repeats the name and extra fields at its own lengths,
      // which are not always the ones in the central directory. Reading the
      // central copy here is a classic way to land a few bytes into the data.
      if (localHeader + 30 > buf.length) return null;
      const localNameLength = buf.readUInt16LE(localHeader + 26);
      const localExtraLength = buf.readUInt16LE(localHeader + 28);
      const start = localHeader + 30 + localNameLength + localExtraLength;
      const raw = buf.subarray(start, start + compressedSize);

      if (method === 0) return raw;
      if (method === 8) {
        try {
          return zlib.inflateRawSync(raw);
        } catch {
          return null;
        }
      }
      return null;
    }

    at += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

// The number out of "TaxifyAndroid/12 Play". Null when the text is not the
// config, or carries no marker — an app built before the marker existed
// reports nothing, and the caller treats that as unknown rather than as zero.
export function markerVersionFrom(configText) {
  let config;
  try {
    config = JSON.parse(String(configText));
  } catch {
    return null;
  }
  const agent = config?.android?.appendUserAgent;
  const found = /TaxifyAndroid\/(\d+)/i.exec(String(agent || ''));
  if (!found) return null;
  const code = Number(found[1]);
  return Number.isInteger(code) && code > 0 ? code : null;
}

// Cached on the file's size and modification time, so replacing the APK is
// still all a release takes — the next request sees a different stat and reads
// it again. Without this every /app/version call would decompress a 5MB zip.
let cached = null;

export function apkMarkerVersion(apkPath) {
  let stat;
  try {
    stat = fs.statSync(apkPath);
  } catch {
    cached = null;
    return null;
  }

  const key = `${stat.size}:${stat.mtimeMs}`;
  if (cached && cached.key === key) return cached.version;

  let version = null;
  try {
    version = markerVersionFrom(readZipEntry(fs.readFileSync(apkPath), CONFIG_ENTRY));
  } catch {
    version = null;
  }

  cached = { key, version };
  return version;
}

// Test seam. The cache is keyed on the file, so this is only needed when a
// test writes two different files to the same path inside one millisecond.
export function clearApkVersionCache() {
  cached = null;
}
