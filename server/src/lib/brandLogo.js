import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The mark as a raster, for the places that cannot draw vectors.
//
// The PDF exports draw the logo with PDFKit — see pdfBranding.js — because they
// can. A spreadsheet cannot: an xlsx embeds an image or it has nothing, and
// what it had was the word "TAXIFY" typed into a cell in a blue that is not one
// of ours.
//
// This is read from client/public rather than client/dist so that it is there
// whether or not the client has been built, and cached because a summary
// export should not touch the disk once per download.
const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'client', 'public', 'icon-192.png');

let cached;

// The PNG bytes, or null if the file has gone. Null rather than a throw: a
// missing logo should cost the export its letterhead, not the whole download.
export function brandLogoPng() {
  if (cached !== undefined) return cached;
  try {
    cached = fs.readFileSync(LOGO_PATH);
  } catch (err) {
    console.error(`[export] no brand logo at ${LOGO_PATH} — ${err.message}`);
    cached = null;
  }
  return cached;
}
