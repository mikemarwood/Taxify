import path from 'path';

// Sending a user-uploaded file back to the browser.
//
// Receipts are served inline from the app's own origin so they can be previewed
// without downloading, which means the browser executes whatever the file
// claims to be. The headers here are what stop that mattering — and they apply
// to files already on disk, which a change to the upload rules cannot.

// Deliberately an allow-list. Anything unrecognised is sent as a download with
// a neutral type rather than being sniffed.
const INLINE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
};

// Quoted, with anything that would break out of the quoting removed.
function contentDisposition(kind, name) {
  const safe = String(name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return `${kind}; filename="${safe}"`;
}

export function serveAttachment(res, filePath, { originalName, download = false } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const type = INLINE_TYPES[ext];
  const inline = !download && !!type;

  res.type(type || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', originalName || path.basename(filePath)));

  // Never let the browser second-guess the type we just declared.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Even if a script-bearing file gets served inline, this gives it nothing to
  // work with: no scripts, no network, and an opaque origin. It is the only
  // protection that reaches files uploaded before the rules were tightened.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'none'; sandbox");

  // These are per-account authenticated files and must not sit in any shared
  // cache between here and the reader.
  res.setHeader('Cache-Control', 'private, no-store');

  return res.sendFile(filePath);
}
