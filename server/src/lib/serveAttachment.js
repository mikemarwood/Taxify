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
  // cache between here and the reader — which is what `private` says.
  //
  // It used to say no-store as well, and that was why receipts felt slow:
  // no-store denies the browser its own disk cache, so every look at the same
  // photo pulled the whole original down again. A phone-camera receipt is
  // several megabytes and the preview box is about 200 pixels wide.
  //
  // no-cache is not a weaker version of that. It means "keep it, but check
  // with me before showing it", and the check carries the session cookie — so
  // a signed-out browser on a shared machine still gets a 401 and no picture,
  // while a signed-in one gets a 304 with no body at all.
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');

  return res.sendFile(filePath);
}
