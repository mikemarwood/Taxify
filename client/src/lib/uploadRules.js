// What may be attached, and how big — the browser's half of the rule.
//
// This mirrors server/src/lib/uploadRules.js deliberately. The server is the
// one that decides; this exists so somebody is told before they wait for an
// upload to finish, and so the file picker greys out what would be refused.
// Anywhere the two disagree, the person picking the file is the one who pays
// for it, so they are kept side by side and tested.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = '10MB';

// SVG is an image by MIME type and a script host by nature. Uploads are served
// back inline from the app's own origin, so one would run in the owner's
// session — and in an administrator's, if they ever used "view as" on that
// account. The server refuses it; refusing it here too means nobody uploads
// one and waits to find out.
//
// This has to be checked FIRST. `image/svg+xml` satisfies the "any image"
// branch below and would never reach an extension check, so leaving .svg out
// of a list would have changed nothing.
const BLOCKED_MIME = new Set(['image/svg+xml', 'image/svg+xml-compressed']);
const BLOCKED_EXT = /\.svgz?$/i;

const DOC_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Any image type is allowed rather than a fixed list: new formats keep
// appearing and there is no reason to refuse one for being newer than this
// file. PDFs and Word documents are the non-image cases people actually have.
const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|jfif|pdf|docx?)$/i;

// The extensions are for Windows, which matches on those; the MIME types are
// for iOS, which matches on those and greys out everything else in Files if it
// is only ever given extensions. Both lists, so both behave.
export const BROWSE_ACCEPT = [
  'image/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.heic',
  '.heif',
  '.pdf',
  '.doc',
  '.docx',
].join(',');

export const UPLOAD_REJECTED_MESSAGE =
  'Only images, PDFs and Word documents can be attached (SVG files are not accepted).';

export const UPLOAD_TOO_LARGE_MESSAGE = `That file is too large — attachments must be ${MAX_UPLOAD_LABEL} or smaller.`;

// The extension is the fallback because a HEIC off an iPhone — or a .doc off a
// network share — often arrives with no usable MIME type at all.
export function isAllowedUpload(file) {
  const name = file?.name || '';
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : '';

  if (BLOCKED_MIME.has(type)) return false;
  if (BLOCKED_EXT.test(name)) return false;

  if (DOC_MIME.has(type)) return true;
  if (type.startsWith('image/')) return true;
  return ALLOWED_EXT.test(name);
}

// Why this file cannot be attached, or null if it can. One function so every
// caller says the same thing for the same reason.
export function uploadProblem(file) {
  if (!isAllowedUpload(file)) return UPLOAD_REJECTED_MESSAGE;
  if (file.size > MAX_UPLOAD_BYTES) return UPLOAD_TOO_LARGE_MESSAGE;
  return null;
}

// The extension on its own, upper-cased, for showing what kind of file a row
// holds — "PDF", "JPG", "DOCX". Empty when there is nothing useful to show,
// which is better than a badge reading "FILE".
export function fileKind(name) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''));
  if (!match) return '';
  const ext = match[1].toUpperCase();
  // JPEG and JPG are the same thing and one is narrower in a list.
  return ext === 'JPEG' ? 'JPG' : ext === 'TIFF' ? 'TIF' : ext;
}
