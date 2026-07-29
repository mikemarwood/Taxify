#!/usr/bin/env node
// One-off CLI to import historical tax-tracking spreadsheets into a Taxify
// account. Run locally — never invoked by the running server, and never
// bundles anyone's real transaction data into the committed source.
//
// Usage:
//   node server/src/scripts/importLegacy.js <xlsx-file-or-dir> <email> [name] [password]
//   node server/src/scripts/importLegacy.js <xlsx-file-or-dir> <email> --dry-run
//
// Accepts either a single .xlsx or a directory of them. Each sheet (other than
// "Outcome", an income summary) becomes expenses under a matching category;
// unmapped sheet names fall back to "Business".
//
// Safe to re-run. Every row is written with a deterministic import_key
// ("legacy:<financial-year>:<sheet>:<row>") behind a unique index, so a second
// run inserts nothing rather than duplicating the import.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import pool, { ensureSchema } from '../db.js';
import { hashPassword } from '../auth/password.js';
import { seedDefaultCategories } from '../seed/defaultCategories.js';
import {
  SKIP_SHEETS,
  categoryForSheet,
  financialYearStartFromFilename,
  financialYearLabelFromFilename,
  readSheetRows,
  parseSheetExpenses,
} from '../lib/legacySheet.js';

async function resolveUser(email, name, password) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const [existingRows] = await pool.execute('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
  if (existingRows[0]) return existingRows[0];

  if (!name || !password) {
    throw new Error(`No account exists for ${normalizedEmail} yet — pass a name and password to create one.`);
  }
  const passwordHash = hashPassword(password);
  const [result] = await pool.execute('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)', [
    normalizedEmail,
    passwordHash,
    name,
  ]);
  await seedDefaultCategories(pool, result.insertId);
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
  console.log(`Created new account for ${normalizedEmail}`);
  return rows[0];
}

function resolveWorkbookPaths(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs
    .readdirSync(target)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map((f) => path.join(target, f));
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const [target, email, name, password] = argv.filter((a) => a !== '--dry-run');

  if (!target || !email) {
    console.error('Usage: node importLegacy.js <xlsx-file-or-dir> <email> [name] [password] [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(target)) {
    console.error(`No such file or directory: ${target}`);
    process.exit(1);
  }

  await ensureSchema();
  const user = await resolveUser(email, name, password);

  const [categoryRows] = await pool.execute('SELECT id, name FROM categories WHERE user_id = ?', [user.id]);
  const categories = categoryRows;
  async function ensureCategory(categoryName) {
    const existing = categories.find((c) => c.name === categoryName);
    if (existing) return existing.id;
    if (dryRun) return null;
    const [result] = await pool.execute(
      'INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)',
      [user.id, categoryName, '#3b82f6', 'briefcase']
    );
    categories.push({ id: result.insertId, name: categoryName });
    return result.insertId;
  }
  // make sure defaults exist even for a pre-existing account created before seeding
  const [defaultTemplates] = await pool.execute('SELECT name FROM default_categories');
  for (const c of defaultTemplates) await ensureCategory(c.name);

  const files = resolveWorkbookPaths(target);
  if (files.length === 0) {
    console.error(`No .xlsx files found in ${target}`);
    process.exit(1);
  }

  let inserted = 0;
  let skipped = 0;
  let totalAmount = 0;

  for (const fullPath of files) {
    const file = path.basename(fullPath);
    console.log(`\nReading ${file}...`);
    const workbook = xlsx.readFile(fullPath);
    const fallbackDate = financialYearStartFromFilename(file);
    const fyLabel = financialYearLabelFromFilename(file);

    for (const sheetName of workbook.SheetNames) {
      if (SKIP_SHEETS.has(sheetName)) continue;

      const categoryName = categoryForSheet(sheetName);
      const categoryId = await ensureCategory(categoryName);
      const rows = readSheetRows(workbook, sheetName);
      const entries = parseSheetExpenses(rows, fallbackDate);
      if (entries.length === 0) continue;

      const sheetTotal = entries.reduce((sum, e) => sum + e.amount, 0);
      totalAmount += sheetTotal;

      if (dryRun) {
        console.log(`  ${sheetName} -> ${categoryName}: ${entries.length} entries, $${sheetTotal.toFixed(2)}`);
        skipped += entries.length;
        continue;
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const entry of entries) {
          const importKey = `legacy:${fyLabel}:${sheetName}:${entry.rowNumber}`;
          const [result] = await connection.execute(
            `INSERT INTO expenses
               (user_id, category_id, item_name, amount, currency, purchase_date, is_recurring, frequency, notes, import_key)
             VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
             ON DUPLICATE KEY UPDATE id = id`,
            [user.id, categoryId, entry.itemName, entry.amount, entry.currency, entry.date, entry.note, importKey]
          );
          if (result.affectedRows > 0) inserted++;
          else skipped++;
        }
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      console.log(`  ${sheetName} -> ${categoryName}: ${entries.length} entries, $${sheetTotal.toFixed(2)}`);
    }
  }

  if (dryRun) {
    console.log(`\nDry run — nothing written. ${skipped} entries parsed, $${totalAmount.toFixed(2)} total.`);
  } else {
    console.log(`\nDone. ${inserted} inserted, ${skipped} already present, $${totalAmount.toFixed(2)} parsed total for ${user.email}.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
