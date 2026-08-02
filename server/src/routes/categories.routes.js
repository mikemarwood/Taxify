import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { requireAuth, requireActiveAccess } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { toTitleCase } from '../lib/text.js';
import {
  receiptsRootDir,
  categoryToFolderSegment,
  categoryDocumentDir,
  uniqueFilenameIn,
  assertWithin,
  isFinancialYearLabel,
  INBOX_SEGMENT,
} from '../lib/receiptStorage.js';
import { financialYearRange, defaultFinancialYear } from '../lib/financialYear.js';
import { ensureCategoriesForYear } from '../lib/categoryYears.js';
import { viewableCopy } from '../lib/heicPreview.js';
import { serveAttachment } from '../lib/serveAttachment.js';
import { MAX_UPLOAD_BYTES, isAllowedUpload, UPLOAD_REJECTED_MESSAGE } from '../lib/uploadRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const router = Router();
router.use(requireAuth, requireActiveAccess);

// Every financial-year folder under the user's receipts root that currently
// has a subfolder for this category — used by both rename (to move) and
// delete (to check for leftover files / remove). The inbox sits beside the
// year folders and is organised by its own slugs, so it's skipped.
function categoryFoldersFor(userId, categorySegment) {
  const root = receiptsRootDir(uploadsDir, userId);
  let yearDirs = [];
  try {
    yearDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== INBOX_SEGMENT)
      .map((e) => e.name);
  } catch {
    return [];
  }
  return yearDirs
    .map((year) => path.join(root, year, categorySegment))
    .filter((dir) => fs.existsSync(dir));
}

// Points an expense's receipt_path at the name a file actually ended up with
// after a collision. Scoped to the financial year the folder represents, since
// the same filename can legitimately exist in this category in another year.
async function repointReceipt(userId, categoryId, yearLabel, oldName, newName) {
  const range = financialYearRange(yearLabel);
  if (!range) return;
  await pool.execute(
    `UPDATE expenses SET receipt_path = ?
     WHERE user_id = ? AND category_id = ? AND receipt_path = ?
       AND purchase_date >= ? AND purchase_date <= ?`,
    [newName, userId, categoryId, oldName, range.start, range.end]
  );
}

function dirHasFiles(dir) {
  try {
    return fs.readdirSync(dir).some((name) => fs.statSync(path.join(dir, name)).isFile());
  } catch {
    return false;
  }
}

const PALETTE = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#a1a1aa', '#ef4444', '#eab308', '#14b8a6'];

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 40;

function validateName(name) {
  if (!name || !String(name).trim()) return 'Category name is required';
  const trimmed = String(name).trim();
  if (trimmed.length < MIN_NAME_LENGTH) return `Category name must be at least ${MIN_NAME_LENGTH} characters`;
  if (trimmed.length > MAX_NAME_LENGTH) return `Category name must be ${MAX_NAME_LENGTH} characters or fewer`;
  return null;
}

// Which financial year the request is about. Anything unrecognised falls back
// to the current one rather than erroring — a caller with no opinion means
// "now", not "nothing".
function requestedYear(req) {
  const asked = req.query?.financialYear || req.body?.financialYear;
  return isFinancialYearLabel(asked) ? String(asked) : defaultFinancialYear(req.user.financialYearRule);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const financialYear = requestedYear(req);

    // Opening a year you haven't used yet carries last year's set forward, so
    // July doesn't start with an empty page. An accountant only ever reads, so
    // their visit never creates anything.
    if (!req.user.actingAsClient) {
      await ensureCategoriesForYear(pool, req.user.id, financialYear);
    }

    // How much has gone through a category is what makes the list worth
    // looking at — a name and a colour on their own say nothing.
    const [categories] = await pool.execute(
      `SELECT c.id, c.name, c.color, c.icon, c.is_property_rental, c.financial_year,
              (SELECT COUNT(*) FROM category_documents d WHERE d.category_id = c.id) AS document_count,
              (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id AND e.deleted_at IS NULL) AS expense_count,
              (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
                WHERE e.category_id = c.id AND e.deleted_at IS NULL) AS total_amount
       FROM categories c
       WHERE c.user_id = ? AND (c.financial_year = ? OR c.financial_year IS NULL)
       ORDER BY c.name`,
      [req.user.id, financialYear]
    );

    // Every year this account has categories for, so the page can offer them
    // without guessing.
    const [years] = await pool.execute(
      `SELECT DISTINCT financial_year FROM categories
       WHERE user_id = ? AND financial_year IS NOT NULL ORDER BY financial_year DESC`,
      [req.user.id]
    );

    res.json({
      financialYear,
      years: years.map((y) => y.financial_year),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        financialYear: c.financial_year,
        isPropertyRental: !!c.is_property_rental,
        documentCount: Number(c.document_count) || 0,
        expenseCount: Number(c.expense_count) || 0,
        totalAmount: Number(c.total_amount) || 0,
      })),
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, color, icon } = req.body || {};
    const nameError = validateName(name);
    if (nameError) return res.status(400).json({ error: nameError });

    const financialYear = requestedYear(req);
    const finalColor = color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
    try {
      const [result] = await pool.execute(
        'INSERT INTO categories (user_id, name, color, icon, financial_year) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, toTitleCase(String(name).trim()), finalColor, icon || 'tag', financialYear]
      );
      const [rows] = await pool.execute(
        'SELECT id, name, color, icon, financial_year FROM categories WHERE id = ?',
        [result.insertId]
      );
      res.status(201).json({ category: rows[0] });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: `You already have a category called that in ${financialYear}` });
      }
      throw err;
    }
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name, color, icon, isPropertyRental } = req.body || {};

    const [existingRows] = await pool.execute(
      'SELECT id, name, color, icon, is_property_rental FROM categories WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    let finalName = existing.name;
    if (name !== undefined) {
      const nameError = validateName(name);
      if (nameError) return res.status(400).json({ error: nameError });
      finalName = toTitleCase(String(name).trim());
    }
    const finalColor = color || existing.color;
    const finalIcon = icon || existing.icon;
    const finalRental = isPropertyRental === undefined ? existing.is_property_rental : isPropertyRental ? 1 : 0;

    try {
      await pool.execute(
        'UPDATE categories SET name = ?, color = ?, icon = ?, is_property_rental = ? WHERE id = ? AND user_id = ?',
        [finalName, finalColor, finalIcon, finalRental, req.params.id, req.user.id]
      );
      const [rows] = await pool.execute(
        'SELECT id, name, color, icon, is_property_rental FROM categories WHERE id = ?',
        [req.params.id]
      );

      // Receipt folders are named after the category, so a rename has to take
      // the files with it or every receipt in that category goes missing.
      if (finalName !== existing.name) {
        const oldSeg = categoryToFolderSegment(existing.name);
        const newSeg = categoryToFolderSegment(finalName);
        for (const oldDir of categoryFoldersFor(req.user.id, oldSeg)) {
          const newDir = path.join(path.dirname(oldDir), newSeg);
          try {
            if (!fs.existsSync(newDir)) {
              fs.renameSync(oldDir, newDir);
              continue;
            }

            // Two category names can sanitise to the same folder, so the
            // destination may already hold a file of the same name. Rename the
            // incoming one rather than overwriting, and correct the database
            // row that points at it — receipt_path is a bare filename, so a
            // silent rename here would orphan the receipt.
            const year = path.basename(path.dirname(oldDir));
            for (const file of fs.readdirSync(oldDir)) {
              const stored = uniqueFilenameIn(newDir, file);
              fs.renameSync(path.join(oldDir, file), path.join(newDir, stored));
              if (stored !== file) {
                await repointReceipt(req.user.id, req.params.id, year, file, stored);
              }
            }
            fs.rmSync(oldDir, { recursive: true, force: true });
          } catch (err) {
            console.error('Failed to rename category receipt folder', err);
          }
        }
      }

      // Documents are filed under the category name too, so they move with a
      // rename for the same reason receipts do.
      if (finalName !== existing.name) {
        const from = categoryDocumentDir(uploadsDir, req.user.id, existing.name);
        const to = categoryDocumentDir(uploadsDir, req.user.id, finalName);
        if (fs.existsSync(from) && from !== to) {
          try {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            if (!fs.existsSync(to)) fs.renameSync(from, to);
            else for (const f of fs.readdirSync(from)) fs.renameSync(path.join(from, f), path.join(to, f));
          } catch (err) {
            console.error('Failed to move category documents', err);
          }
        }
      }

      const row = rows[0];
      res.json({
        category: {
          id: row.id,
          name: row.name,
          color: row.color,
          icon: row.icon,
          isPropertyRental: !!row.is_property_rental,
        },
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'A category with that name already exists' });
      }
      throw err;
    }
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [categoryRows] = await pool.execute('SELECT name FROM categories WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (!categoryRows[0]) return res.status(404).json({ error: 'Category not found' });

    const [[{ count }]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM expenses WHERE category_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (count > 0) {
      return res.status(400).json({
        error: `Cannot delete a category that still has ${count} expense${count === 1 ? '' : 's'} — move or delete them first.`,
      });
    }

    const categorySeg = categoryToFolderSegment(categoryRows[0].name);
    const folders = categoryFoldersFor(req.user.id, categorySeg);
    if (folders.some(dirHasFiles)) {
      return res.status(400).json({
        error: 'This category still has unassigned receipt files — remove them first.',
      });
    }

    const [result] = await pool.execute('DELETE FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });

    for (const dir of folders) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to remove category receipt folder', err);
      }
    }

    res.json({ ok: true });
  })
);

// --- Category documents --------------------------------------------------
//
// Paperwork that belongs to the category rather than to a single expense: a
// rental's agent statements, depreciation schedule, end-of-financial-year
// summary. Only property-rental categories offer it, since that's where the
// per-property paperwork actually accumulates.

async function loadRentalCategory(req, res) {
  const [rows] = await pool.execute(
    'SELECT id, name, is_property_rental FROM categories WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  const category = rows[0];
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return null;
  }
  if (!category.is_property_rental) {
    res.status(400).json({ error: 'Documents are only available on property rental categories' });
    return null;
  }
  return category;
}

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        // multer streams files as it parses, so a text field only exists here
        // if it was sent before the files — the client appends it first.
        const year = req.body?.financialYear;
        if (!isFinancialYearLabel(year)) return cb(Object.assign(new Error('A financial year is required'), { status: 400 }));

        const [rows] = await pool.execute('SELECT name FROM categories WHERE id = ? AND user_id = ?', [
          req.params.id,
          req.user.id,
        ]);
        if (!rows[0]) return cb(Object.assign(new Error('Category not found'), { status: 404 }));
        const dir = categoryDocumentDir(uploadsDir, req.user.id, rows[0].name, year);
        fs.mkdirSync(dir, { recursive: true });
        req._uploadDir = assertWithin(uploadsDir, dir);
        cb(null, req._uploadDir);
      } catch (err) {
        cb(err);
      }
    },
    // Same rule as a receipt: keep the name it arrived with, suffix only on a
    // collision, never overwrite. An end-of-year statement is worth far more
    // when it's still called what the agent called it.
    filename: (req, file, cb) => {
      req._takenNames = req._takenNames || new Set();
      cb(null, uniqueFilenameIn(req._uploadDir, path.basename(file.originalname), req._takenNames));
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 50 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file)) return cb(Object.assign(new Error(UPLOAD_REJECTED_MESSAGE), { status: 400 }));
    cb(null, true);
  },
});

// Every category document filed against one financial year, whichever category
// it belongs to. At tax time the question is "what paperwork do I have for
// 2025-2026", not "what has this one property got" — so the year is the thing
// you ask by, and the category is just a label on the answer.
router.get(
  '/documents/year/:financialYear',
  asyncHandler(async (req, res) => {
    const { financialYear } = req.params;
    if (!isFinancialYearLabel(financialYear)) {
      return res.status(400).json({ error: 'Invalid financial year' });
    }

    const [rows] = await pool.execute(
      `SELECT d.id, d.filename, d.original_name, d.document_name, d.financial_year, d.size_bytes, d.uploaded_at,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
       FROM category_documents d
       JOIN categories c ON c.id = d.category_id
       WHERE d.user_id = ? AND d.financial_year = ?
       ORDER BY c.name, d.uploaded_at DESC, d.id DESC`,
      [req.user.id, financialYear]
    );

    res.json({
      financialYear,
      documents: rows.map((d) => ({
        id: d.id,
        filename: d.filename,
        originalName: d.original_name,
        documentName: d.document_name || d.original_name,
        financialYear: d.financial_year,
        sizeBytes: d.size_bytes,
        uploadedAt: d.uploaded_at,
        category: {
          id: d.category_id,
          name: d.category_name,
          color: d.category_color,
          icon: d.category_icon,
        },
        url: `/api/categories/${d.category_id}/documents/${encodeURIComponent(d.filename)}?year=${encodeURIComponent(
          d.financial_year || ''
        )}`,
      })),
    });
  })
);

router.get(
  '/:id/documents',
  asyncHandler(async (req, res) => {
    const category = await loadRentalCategory(req, res);
    if (!category) return;

    const [rows] = await pool.execute(
      `SELECT id, filename, original_name, document_name, financial_year, size_bytes, uploaded_at
       FROM category_documents WHERE category_id = ? AND user_id = ?
       ORDER BY financial_year DESC, uploaded_at DESC, id DESC`,
      [category.id, req.user.id]
    );

    // Grouped server-side because the financial year is the organising idea
    // here, not a filter — at tax time you want one year's paperwork together.
    const byYear = new Map();
    for (const d of rows) {
      const year = d.financial_year || 'Unfiled';
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push({
        id: d.id,
        filename: d.filename,
        originalName: d.original_name,
        documentName: d.document_name || d.original_name,
        financialYear: d.financial_year,
        sizeBytes: d.size_bytes,
        uploadedAt: d.uploaded_at,
        url: `/api/categories/${category.id}/documents/${encodeURIComponent(d.filename)}?year=${encodeURIComponent(
          d.financial_year || ''
        )}`,
      });
    }

    res.json({
      years: Array.from(byYear.entries()).map(([year, documents]) => ({ year, documents })),
      directory: categoryDocumentDir(uploadsDir, req.user.id, category.name),
    });
  })
);

router.post(
  '/:id/documents',
  documentUpload.array('documents', 50),
  asyncHandler(async (req, res) => {
    const category = await loadRentalCategory(req, res);
    if (!category) return;

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const financialYear = req.body?.financialYear;
    if (!isFinancialYearLabel(financialYear)) {
      return res.status(400).json({ error: 'A financial year is required' });
    }

    // Title Case, so a list of statements reads consistently however each one
    // was typed. Applied per upload: naming a single document names it, while
    // a batch shares the name with the original filename kept underneath.
    const rawName = req.body?.documentName ? String(req.body.documentName).trim().slice(0, 200) : '';
    const documentName = rawName ? toTitleCase(rawName) : null;

    for (const file of files) {
      const original = path.basename(file.originalname);
      await pool.execute(
        `INSERT INTO category_documents
           (user_id, category_id, filename, original_name, document_name, financial_year, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          category.id,
          file.filename,
          original,
          documentName || toTitleCase(original.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')),
          financialYear,
          file.size,
        ]
      );
    }
    res.status(201).json({ uploaded: files.length, financialYear });
  })
);

router.get(
  '/:id/documents/:filename',
  asyncHandler(async (req, res) => {
    const category = await loadRentalCategory(req, res);
    if (!category) return;

    // The row is the authority on what belongs to this category, and on which
    // year folder it sits in — neither the filename nor the year off the URL
    // reaches the filesystem unverified.
    const [rows] = await pool.execute(
      'SELECT filename, original_name, financial_year FROM category_documents WHERE category_id = ? AND user_id = ? AND filename = ?',
      [category.id, req.user.id, req.params.filename]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });

    const dir = categoryDocumentDir(uploadsDir, req.user.id, category.name, rows[0].financial_year);
    let filePath;
    try {
      filePath = assertWithin(uploadsDir, path.join(dir, rows[0].filename));
    } catch {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    if (req.query.download) return res.download(filePath, rows[0].original_name || rows[0].filename);
    return serveAttachment(res, (await viewableCopy(uploadsDir, filePath)) || filePath, {
      originalName: rows[0].original_name || rows[0].filename,
    });
  })
);

router.delete(
  '/:id/documents/:filename',
  asyncHandler(async (req, res) => {
    const category = await loadRentalCategory(req, res);
    if (!category) return;

    const [rows] = await pool.execute(
      'SELECT id, filename, financial_year FROM category_documents WHERE category_id = ? AND user_id = ? AND filename = ?',
      [category.id, req.user.id, req.params.filename]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });

    await pool.execute('DELETE FROM category_documents WHERE id = ?', [rows[0].id]);
    try {
      const dir = categoryDocumentDir(uploadsDir, req.user.id, category.name, rows[0].financial_year);
      fs.unlinkSync(path.join(dir, rows[0].filename));
    } catch {
      // already gone from disk — the row is what mattered
    }
    res.json({ ok: true });
  })
);

export default router;
