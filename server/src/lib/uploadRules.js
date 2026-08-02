import path from 'path';

// What may be attached to an expense or a category, and how big. Shared so a
// receipt and a rental document can't drift apart on what they accept — a file
// the app takes in one place and rejects in the other is only ever confusing.
//
// Any image type is allowed rather than a fixed list: new formats keep
// appearing (avif, jxl) and there's no reason to reject one just because this
// predates it. PDFs and Word documents are the non-image cases people actually
// have. Everything else is refused.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
  '.avif',
  '.bmp',
  '.tif',
  '.tiff',
  '.jfif',
  '.pdf',
  '.doc',
  '.docx',
]);

const ALLOWED_DOC_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// SVG is an image by MIME type and a script host by nature. Receipts are
// served back inline from the app's own origin, so one uploaded here would run
// in the owner's session — and in an administrator's, if they ever used "view
// as" on that account.
//
// This has to be a deny-list checked FIRST, not an omission from the allow
// list: `image/svg+xml` satisfies the `startsWith('image/')` branch below and
// never reaches the extension check, so removing '.svg' from the list above
// would have changed nothing at all.
const BLOCKED_MIME = new Set(['image/svg+xml', 'image/svg+xml-compressed']);
const BLOCKED_EXT = new Set(['.svg', '.svgz']);

export const UPLOAD_REJECTED_MESSAGE =
  'Only images, PDFs and Word documents can be attached (SVG files are not accepted)';

// iPhone photos often arrive with no useful MIME type — Windows and some
// browsers report .heic as application/octet-stream or an empty string, and a
// .doc off a network share often arrives as octet-stream too — so the
// extension is the fallback when the reported type says nothing useful.
export function isAllowedUpload(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  const mime = typeof file?.mimetype === 'string' ? file.mimetype.toLowerCase() : '';

  // Either signal being blocked is enough; a .png name on an SVG payload is
  // exactly the case a naive fix leaves open.
  if (BLOCKED_EXT.has(ext) || BLOCKED_MIME.has(mime)) return false;

  if (ALLOWED_DOC_MIME.has(mime)) return true;
  if (mime.startsWith('image/')) return true;
  return ALLOWED_UPLOAD_EXT.has(ext);
}
