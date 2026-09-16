import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { readZipEntry, markerVersionFrom, apkMarkerVersion, clearApkVersionCache } from './apkVersion.js';

// A zip, built here rather than committed as a fixture, so the test says what
// it is testing. One entry, stored or deflated, which is all an APK's
// capacitor.config.json is ever written as.
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, content, method] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32 ? zlib.crc32(raw) : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

const CONFIG = 'assets/capacitor.config.json';
const config = (agent) => JSON.stringify({ android: { appendUserAgent: agent } });

test('reads a stored entry out of a zip', () => {
  const zip = makeZip([[CONFIG, config('TaxifyAndroid/12 Play'), 0]]);
  assert.equal(String(readZipEntry(zip, CONFIG)), config('TaxifyAndroid/12 Play'));
});

test('reads a deflated entry out of a zip', () => {
  const zip = makeZip([[CONFIG, config('TaxifyAndroid/7'), 8]]);
  assert.equal(String(readZipEntry(zip, CONFIG)), config('TaxifyAndroid/7'));
});

test('finds the entry when it is not the first one', () => {
  const zip = makeZip([
    ['assets/public/index.html', '<!doctype html>hello', 8],
    [CONFIG, config('TaxifyAndroid/9'), 8],
    ['classes.dex', 'not really a dex', 0],
  ]);
  assert.equal(String(readZipEntry(zip, CONFIG)), config('TaxifyAndroid/9'));
});

test('an entry that is not there is null, not a throw', () => {
  const zip = makeZip([['classes.dex', 'x', 0]]);
  assert.equal(readZipEntry(zip, CONFIG), null);
});

test('rubbish in is null out', () => {
  assert.equal(readZipEntry(Buffer.from('not a zip at all'), CONFIG), null);
  assert.equal(readZipEntry(Buffer.alloc(0), CONFIG), null);
  assert.equal(readZipEntry(null, CONFIG), null);
});

test('pulls the build number out of the marker', () => {
  assert.equal(markerVersionFrom(config('TaxifyAndroid/12 Play')), 12);
  assert.equal(markerVersionFrom(config('TaxifyAndroid/5')), 5);
});

test('no marker is unknown rather than zero', () => {
  // A build old enough to carry no marker must not read as version 0, which
  // would make every later build look like an update it cannot deliver.
  assert.equal(markerVersionFrom(config('')), null);
  assert.equal(markerVersionFrom(config('SomethingElse/3')), null);
  assert.equal(markerVersionFrom('{}'), null);
  assert.equal(markerVersionFrom('not json'), null);
  assert.equal(markerVersionFrom(null), null);
});

test('reads the marker straight out of an APK on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxify-apk-'));
  const apk = path.join(dir, 'taxify.apk');
  fs.writeFileSync(apk, makeZip([[CONFIG, config('TaxifyAndroid/11'), 8]]));
  clearApkVersionCache();
  assert.equal(apkMarkerVersion(apk), 11);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing APK is null, and does not poison the cache', () => {
  clearApkVersionCache();
  assert.equal(apkMarkerVersion(path.join(os.tmpdir(), 'taxify-does-not-exist.apk')), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxify-apk-'));
  const apk = path.join(dir, 'taxify.apk');
  fs.writeFileSync(apk, makeZip([[CONFIG, config('TaxifyAndroid/6'), 8]]));
  assert.equal(apkMarkerVersion(apk), 6);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the real APK, if one is published, carries a marker', () => {
  // The bug this file exists for: the shipped APK said 5 while the server
  // advertised 12, so every install was told to update to a build the download
  // could not produce. Whatever the number is, it has to be readable — an
  // unreadable one falls back to the hand-kept file and the drift is possible
  // all over again.
  const apk = new URL('../../../client/public/downloads/taxify.apk', import.meta.url);
  if (!fs.existsSync(apk)) return;
  clearApkVersionCache();
  const version = apkMarkerVersion(apk);
  assert.ok(Number.isInteger(version) && version > 0, `expected a build number, got ${version}`);
});
