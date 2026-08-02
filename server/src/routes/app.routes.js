import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../lib/asyncHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const versionFile = path.join(__dirname, '..', 'app-version.json');

const router = Router();

// The APK itself, so the page can state its real size and when it was built
// rather than a number that stops being true the next time it is replaced.
const apkFile = path.join(__dirname, '..', '..', '..', 'client', 'public', 'downloads', 'taxify.apk');

router.get(
  '/version',
  asyncHandler(async (req, res) => {
    const { versionCode, versionName, notes } = JSON.parse(fs.readFileSync(versionFile, 'utf8'));

    let sizeBytes = null;
    let updatedAt = null;
    try {
      const stat = fs.statSync(apkFile);
      sizeBytes = stat.size;
      updatedAt = stat.mtime;
    } catch {
      // No build published yet. Said plainly rather than offering a download
      // that would 404.
    }

    // Read fresh and never cached, so replacing the file is all a release takes.
    res.set('Cache-Control', 'no-store');
    res.json({
      versionCode,
      versionName,
      notes,
      sizeBytes,
      updatedAt,
      available: sizeBytes !== null,
      url: `${req.protocol}://${req.get('host')}/downloads/taxify.apk`,
    });
  })
);

// Where the client error boundary reports to. Until now a white screen in
// production was completely invisible — there is no client error tracking, so
// the only signal was a customer mentioning it.
router.post(
  '/client-error',
  asyncHandler(async (req, res) => {
    const { message, stack, componentStack, path: at } = req.body || {};
    console.error(
      `[client] ${String(message || 'unknown').slice(0, 500)} at ${String(at || '?').slice(0, 200)}\n` +
        `${String(stack || componentStack || '').slice(0, 2000)}`
    );
    // Always 204: a failure to log must never become a second error on a page
    // that is already broken.
    res.status(204).end();
  })
);

export default router;
