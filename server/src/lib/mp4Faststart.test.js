import test from 'node:test';
import assert from 'node:assert/strict';
import { faststart, isFaststart, readTopLevelAtoms } from './mp4Faststart.js';

function atom(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(8 + payload.length, 0);
  out.write(type, 4, 'latin1');
  payload.copy(out, 8);
  return out;
}

// A stco table: version+flags, count, then the offsets.
function stco(offsets) {
  const body = Buffer.alloc(8 + offsets.length * 4);
  body.writeUInt32BE(0, 0);
  body.writeUInt32BE(offsets.length, 4);
  offsets.forEach((o, i) => body.writeUInt32BE(o, 8 + i * 4));
  return atom('stco', body);
}

function co64(offsets) {
  const body = Buffer.alloc(8 + offsets.length * 8);
  body.writeUInt32BE(0, 0);
  body.writeUInt32BE(offsets.length, 4);
  offsets.forEach((o, i) => body.writeBigUInt64BE(BigInt(o), 8 + i * 8));
  return atom('co64', body);
}

// stco lives four containers deep in a real file, so the test file nests it
// the same way — a walker that only looked at the top level would pass a
// flatter fake and still ship the bug.
function moovWith(table) {
  return atom('moov', atom('trak', atom('mdia', atom('minf', atom('stbl', table)))));
}

function buildFile({ table = stco([48]), mediaBytes = 64, faststartOrder = false } = {}) {
  const ftyp = atom('ftyp', Buffer.from('isomiso2avc1mp41', 'latin1'));
  const mdat = atom('mdat', Buffer.alloc(mediaBytes, 7));
  const moov = moovWith(table);
  return faststartOrder ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov]);
}

test('reads the top-level boxes in order', () => {
  const atoms = readTopLevelAtoms(buildFile());
  assert.deepEqual(
    atoms.map((a) => a.type),
    ['ftyp', 'mdat', 'moov']
  );
});

test('recognises a file that already has its index in front', () => {
  assert.equal(isFaststart(buildFile({ faststartOrder: true })), true);
  assert.equal(isFaststart(buildFile()), false);
});

test('moves the index in front of the media', () => {
  const out = faststart(buildFile());
  assert.deepEqual(
    readTopLevelAtoms(out).map((a) => a.type),
    ['ftyp', 'moov', 'mdat']
  );
  assert.equal(isFaststart(out), true);
});

test('the file is exactly the same size afterwards', () => {
  // Nothing is added or dropped — the same boxes in a different order.
  const before = buildFile();
  assert.equal(faststart(before).length, before.length);
});

test('the media bytes are untouched', () => {
  const before = buildFile({ mediaBytes: 128 });
  const out = faststart(before);
  const mdat = readTopLevelAtoms(out).find((a) => a.type === 'mdat');
  assert.deepEqual(out.slice(mdat.start + 8, mdat.start + mdat.size), Buffer.alloc(128, 7));
});

test('chunk offsets are advanced by exactly the distance the media moved', () => {
  // This is the part that silently corrupts playback if it is wrong: the
  // offsets are absolute file positions, so moving anything invalidates them.
  const before = buildFile({ table: stco([48, 60]) });
  const moovSize = readTopLevelAtoms(before).find((a) => a.type === 'moov').size;
  const out = faststart(before);
  const moov = readTopLevelAtoms(out).find((a) => a.type === 'moov');
  const body = out.slice(moov.start, moov.start + moov.size);
  // indexOf finds the type field, which is 4 bytes into the box: after it come
  // version+flags(4), count(4), then the offsets.
  const at = body.indexOf(Buffer.from('stco', 'latin1'));
  assert.equal(body.readUInt32BE(at + 8), 2, 'two entries');
  assert.equal(body.readUInt32BE(at + 12), 48 + moovSize);
  assert.equal(body.readUInt32BE(at + 16), 60 + moovSize);
});

test('the offsets it writes actually point at the media', () => {
  // The strongest check available without a decoder: the first chunk offset
  // must land on the first byte after the mdat header.
  const before = buildFile({ table: stco([16]) }); // ftyp is 24 bytes, mdat header 8 -> data at 32
  const realStart = readTopLevelAtoms(before).find((a) => a.type === 'mdat').start + 8;
  const withTruth = buildFile({ table: stco([realStart]) });
  const out = faststart(withTruth);
  const mdat = readTopLevelAtoms(out).find((a) => a.type === 'mdat');
  const moov = readTopLevelAtoms(out).find((a) => a.type === 'moov');
  const body = out.slice(moov.start, moov.start + moov.size);
  const at = body.indexOf(Buffer.from('stco', 'latin1'));
  assert.equal(body.readUInt32BE(at + 12), mdat.start + 8);
});

test('handles 64-bit chunk offsets too', () => {
  const before = buildFile({ table: co64([48]) });
  const moovSize = readTopLevelAtoms(before).find((a) => a.type === 'moov').size;
  const out = faststart(before);
  const moov = readTopLevelAtoms(out).find((a) => a.type === 'moov');
  const body = out.slice(moov.start, moov.start + moov.size);
  const at = body.indexOf(Buffer.from('co64', 'latin1'));
  assert.equal(body.readBigUInt64BE(at + 12), BigInt(48 + moovSize));
});

test('leaves a file that is already faststart alone', () => {
  assert.equal(faststart(buildFile({ faststartOrder: true })), null);
});

test('refuses anything that is not an MP4 rather than mangling it', () => {
  assert.equal(faststart(Buffer.from('not an mp4 at all')), null);
  assert.equal(faststart(Buffer.alloc(0)), null);
  assert.equal(readTopLevelAtoms(Buffer.from('nonsense')), null);
});

test('refuses a file whose boxes do not add up', () => {
  // A truncated download must not be "repaired" into something worse.
  const truncated = buildFile().slice(0, 40);
  assert.equal(faststart(truncated), null);
});
