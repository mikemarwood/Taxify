// Moving an MP4's index to the front, so it starts playing before it has
// finished downloading.
//
// An MP4 is a flat list of boxes. `mdat` holds the video; `moov` holds the
// index a player needs before it can decode a single frame. Most encoders
// write `moov` last, because its contents are not known until the media is
// written — which leaves the 20KB a player needs first sitting behind 12MB it
// does not need yet.
//
// On a network that honours HTTP range requests this is invisible: the browser
// fetches the tail, finds the index, and starts. On one that does not — a
// corporate proxy that strips Range, or buffers whole responses — the browser
// has to pull the entire file before it can paint anything, and the frame
// stays blank for as long as that takes. That is the difference between "works
// at home, blank at work", and it is not something the page can fix.
//
// So it is fixed in the file. This is what `ffmpeg -movflags +faststart` and
// `qt-faststart` do, and neither is installed here: `moov` is moved in front of
// `mdat` and every chunk offset inside it is advanced by the distance the media
// moved. Pure byte work, no re-encoding, and the pixels are untouched.

// Boxes that hold other boxes. Walked into when looking for chunk offsets;
// everything else is skipped over.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);

const HEADER = 8;

// The top-level boxes, in order. Returns null if the file is not one we
// recognise, rather than guessing at it.
export function readTopLevelAtoms(buf) {
  const atoms = [];
  let off = 0;
  while (off + HEADER <= buf.length) {
    let size = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    if (!/^[\w\s©-]{4}$/.test(type)) return null;

    let headerSize = HEADER;
    if (size === 1) {
      // 64-bit size, in the eight bytes after the type.
      if (off + 16 > buf.length) return null;
      const large = buf.readBigUInt64BE(off + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      // Runs to the end of the file.
      size = buf.length - off;
    }

    if (size < headerSize || off + size > buf.length) return null;
    atoms.push({ type, start: off, size, headerSize });
    off += size;
  }
  return off === buf.length ? atoms : null;
}

// Walks into the container boxes and adds `delta` to every chunk offset. The
// offsets are absolute positions in the file, which is why moving anything
// means rewriting all of them.
function shiftChunkOffsets(moov, delta) {
  let ok = true;

  function walk(start, end) {
    let off = start;
    while (off + HEADER <= end) {
      const size = moov.readUInt32BE(off);
      const type = moov.slice(off + 4, off + 8).toString('latin1');
      if (size < HEADER || off + size > end) return;

      if (type === 'stco') {
        // version(1) flags(3) count(4), then count 32-bit offsets.
        const count = moov.readUInt32BE(off + 12);
        for (let i = 0; i < count; i++) {
          const at = off + 16 + i * 4;
          if (at + 4 > end) return;
          const moved = moov.readUInt32BE(at) + delta;
          // Past 4GB a 32-bit table cannot hold the answer. Rather than write
          // a wrong offset, the whole conversion is abandoned upstream.
          if (moved > 0xffffffff) {
            ok = false;
            return;
          }
          moov.writeUInt32BE(moved, at);
        }
      } else if (type === 'co64') {
        const count = moov.readUInt32BE(off + 12);
        for (let i = 0; i < count; i++) {
          const at = off + 16 + i * 8;
          if (at + 8 > end) return;
          moov.writeBigUInt64BE(moov.readBigUInt64BE(at) + BigInt(delta), at);
        }
      } else if (CONTAINERS.has(type)) {
        walk(off + HEADER, off + size);
      }

      off += size;
    }
  }

  walk(HEADER, moov.length);
  return ok;
}

// Whether the index already comes before the media.
export function isFaststart(buf) {
  const atoms = readTopLevelAtoms(buf);
  if (!atoms) return null;
  const moov = atoms.findIndex((a) => a.type === 'moov');
  const mdat = atoms.findIndex((a) => a.type === 'mdat');
  if (moov === -1 || mdat === -1) return null;
  return moov < mdat;
}

// The same file with `moov` moved to the front, or null when there is nothing
// to do — already faststart, not an MP4, or a shape this does not handle.
// Null rather than a throw: a video that cannot be improved should still be
// served exactly as it was uploaded.
export function faststart(buf) {
  const atoms = readTopLevelAtoms(buf);
  if (!atoms) return null;

  const moovIndex = atoms.findIndex((a) => a.type === 'moov');
  const mdatIndex = atoms.findIndex((a) => a.type === 'mdat');
  if (moovIndex === -1 || mdatIndex === -1) return null;
  if (moovIndex < mdatIndex) return null; // already in front

  const moovAtom = atoms[moovIndex];
  // A 64-bit moov header would change size when it moves, and the delta below
  // assumes it does not. Not worth handling for a 20KB index.
  if (moovAtom.headerSize !== HEADER) return null;

  const moov = Buffer.from(buf.slice(moovAtom.start, moovAtom.start + moovAtom.size));

  // Everything between the front and moov's old home slides along by exactly
  // the size of moov, and the media is in that stretch.
  if (!shiftChunkOffsets(moov, moovAtom.size)) return null;

  // ftyp has to stay first — it is what tells a player what it is reading.
  // moov goes immediately after it, and the rest keeps its order.
  const head = [];
  const tail = [];
  for (const atom of atoms) {
    if (atom.type === 'moov') continue;
    (atom.type === 'ftyp' ? head : tail).push(buf.slice(atom.start, atom.start + atom.size));
  }

  const out = Buffer.concat([...head, moov, ...tail]);
  return out.length === buf.length ? out : null;
}
