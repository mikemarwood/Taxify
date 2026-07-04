#!/usr/bin/env node
// One-off CLI to import historical tax-tracking spreadsheets into a Taxify
// account. Run locally — never invoked by the running server, and never
// bundles anyone's real transaction data into the committed source.
//
// Usage:
//   node server/src/scripts/importLegacy.js <path-to-xlsx-dir> <email> [name] [password]
//
// Looks for files matching "Tax *.xlsx" in the given directory. Each sheet
// (other than "Outcome", which is an income summary) becomes expenses under
// a matching category: General/Training/Tooling/Electronics/Home Rental map
// directly; any other sheet name (a business name) maps to "Business".

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import db from '../db.js';
import { hashPassword } from '../auth/password.js';
import { seedDefaultCategories, DEFAULT_CATEGORIES } from '../seed/defaultCategories.js';

const CATEGORY_MAP = {
  General: 'General',
  Training: 'Training',
  Tooling: 'Tooling',
  Electronics: 'Electronics',
  'Home Rental': 'Home Rental',
};
const FALLBACK_CATEGORY = 'Business';
const SKIP_SHEETS = new Set(['Outcome']);

function excelSerialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function financialYearStartFromFilename(filename) {
  const match = filename.match(/(\d{4})\s*-\s*(\d{4})/);
  if (!match) return new Date().toISOString().slice(0, 10);
  return `${match[1]}-07-01`;
}

function readSheetRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = xlsx.utils.decode_range(ref);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[xlsx.utils.encode_cell({ r, c })];
      row.push(cell && cell.v !== undefined ? cell.v : '');
    }
    rows.push(row);
  }
  return rows;
}

function parseSheetExpenses(rows, fallbackDate) {
  const recurring = [];
  const single = [];
  let mode = null; // 'recurring' | 'single'

  // Section marker text ("Recurring Payments" / "Single Payments") is
  // inconsistent across sheets (one sheet uses a stray "." instead), so
  // detect the actual column-header rows by shape instead — they're
  // consistent everywhere.
  for (const row of rows) {
    const col0 = typeof row[0] === 'string' ? row[0].trim() : row[0];
    const col1 = typeof row[1] === 'string' ? row[1].trim() : row[1];
    const col3 = typeof row[3] === 'string' ? row[3].trim() : row[3];

    if (col1 === 'Item Name' && col3 === 'Frequency') {
      mode = 'recurring';
      continue;
    }
    if (col0 === 'Date' && col1 === 'Item Name' && col3 === 'Currency') {
      mode = 'single';
      continue;
    }

    if (mode === 'recurring') {
      const itemName = row[1];
      const frequency = row[3];
      const amount = row[4];
      if (itemName && typeof amount === 'number' && amount > 0) {
        recurring.push({ itemName: String(itemName).trim(), frequency: frequency ? String(frequency) : null, amount });
      }
    } else if (mode === 'single') {
      const dateSerial = row[0];
      const itemName = row[1];
      const currency = row[3];
      const amount = row[4];
      if (itemName && typeof amount === 'number' && amount > 0) {
        const date = typeof dateSerial === 'number' ? excelSerialToIso(dateSerial) : fallbackDate;
        single.push({ itemName: String(itemName).trim(), currency: currency ? String(currency) : 'AUD', amount, date });
      }
    }
  }

  return { recurring, single };
}

function resolveUser(email, name, password) {
  const normalizedEmail = String(email).trim().toLowerCase();
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (user) return user;

  if (!name || !password) {
    throw new Error(`No account exists for ${normalizedEmail} yet — pass a name and password to create one.`);
  }
  const passwordHash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(normalizedEmail, passwordHash, name);
  seedDefaultCategories(db, info.lastInsertRowid);
  user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  console.log(`Created new account for ${normalizedEmail}`);
  return user;
}

function main() {
  const [, , dir, email, name, password] = process.argv;
  if (!dir || !email) {
    console.error('Usage: node importLegacy.js <path-to-xlsx-dir> <email> [name] [password]');
    process.exit(1);
  }

  const user = resolveUser(email, name, password);

  let categories = db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(user.id);
  const ensureCategory = (categoryName) => {
    let cat = categories.find((c) => c.name === categoryName);
    if (cat) return cat.id;
    const info = db
      .prepare('INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)')
      .run(user.id, categoryName, '#3b82f6', 'briefcase');
    categories.push({ id: info.lastInsertRowid, name: categoryName });
    return info.lastInsertRowid;
  };
  // make sure defaults exist even for a pre-existing account created before seeding
  for (const c of DEFAULT_CATEGORIES) ensureCategory(c.name);

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^Tax .*\.xlsx$/i.test(f));

  if (files.length === 0) {
    console.error(`No "Tax *.xlsx" files found in ${dir}`);
    process.exit(1);
  }

  const insertExpense = db.prepare(
    `INSERT INTO expenses (user_id, category_id, item_name, amount, currency, purchase_date, is_recurring, frequency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let totalImported = 0;

  for (const file of files) {
    const fullPath = path.join(dir, file);
    console.log(`Reading ${file}...`);
    const workbook = xlsx.readFile(fullPath);
    const fallbackDate = financialYearStartFromFilename(file);

    for (const sheetName of workbook.SheetNames) {
      if (SKIP_SHEETS.has(sheetName)) continue;

      const categoryName = CATEGORY_MAP[sheetName] || FALLBACK_CATEGORY;
      const categoryId = ensureCategory(categoryName);
      const rows = readSheetRows(workbook, sheetName);
      const { recurring, single } = parseSheetExpenses(rows, fallbackDate);

      const importSheet = db.transaction(() => {
        for (const item of recurring) {
          insertExpense.run(user.id, categoryId, item.itemName, item.amount, 'AUD', fallbackDate, 1, item.frequency);
          totalImported++;
        }
        for (const item of single) {
          insertExpense.run(user.id, categoryId, item.itemName, item.amount, item.currency, item.date, 0, null);
          totalImported++;
        }
      });
      importSheet();

      if (recurring.length || single.length) {
        console.log(`  ${sheetName} -> ${categoryName}: ${recurring.length} recurring, ${single.length} single`);
      }
    }
  }

  console.log(`\nDone. Imported ${totalImported} expense entries for ${user.email}.`);
}

main();
