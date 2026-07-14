import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../lib/asyncHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const versionFile = path.join(__dirname, '..', 'app-version.json');

const router = Router();

router.get(
  '/version',
  asyncHandler(async (req, res) => {
    const { versionCode, versionName, notes } = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    res.set('Cache-Control', 'no-store');
    res.json({
      versionCode,
      versionName,
      notes,
      url: `${req.protocol}://${req.get('host')}/downloads/taxify.apk`,
    });
  })
);

export default router;
