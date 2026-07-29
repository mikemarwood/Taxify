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
  '.svg',
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

export const UPLOAD_REJECTED_MESSAGE = 'Only images, PDFs and Word documents can be attached';

// iPhone photos often arrive with no useful MIME type — Windows and some
// browsers report .heic as application/octet-stream or an empty string, and a
// .doc off a network share often arrives as octet-stream too — so the
// extension is the fallback when the reported type says nothing useful.
export function isAllowedUpload(file) {
  if (ALLOWED_DOC_MIME.has(file.mimetype)) return true;
  if (typeof file.mimetype === 'string' && file.mimetype.startsWith('image/')) return true;
  return ALLOWED_UPLOAD_EXT.has(path.extname(file.originalname).toLowerCase());
}
