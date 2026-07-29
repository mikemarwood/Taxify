// Parsing for the historical tax-tracking spreadsheets consumed by
// scripts/importLegacy.js. Kept free of database and filesystem concerns so
// the sheet-shape logic can be exercised on its own.
import xlsx from 'xlsx';

export const CATEGORY_MAP = {
  General: 'General',
  Training: 'Training',
  Tooling: 'Tooling',
  Electronics: 'Electronics',
  'Home Rental': 'Home Rental',
  'Two Rocks Electrical': 'Two Rocks Electrical',
};
export const FALLBACK_CATEGORY = 'Business';
export const SKIP_SHEETS = new Set(['Outcome']);

export function excelSerialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function financialYearStartFromFilename(filename) {
  const match = filename.match(/(\d{4})\s*-\s*(\d{4})/);
  if (!match) return new Date().toISOString().slice(0, 10);
  return `${match[1]}-07-01`;
}

export function financialYearLabelFromFilename(filename) {
  const match = filename.match(/(\d{4})\s*-\s*(\d{4})/);
  return match ? `${match[1]}-${match[2]}` : 'unknown';
}

export function readSheetRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  const ref = ws && ws['!ref'];
  if (!ref) return [];
  const range = xlsx.utils.decode_range(ref);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[xlsx.utils.encode_cell({ r, c })];
      row.push(cell && cell.v !== undefined ? cell.v : '');
    }
    row.rowNumber = r + 1; // 1-based, matches what you see in Excel
    rows.push(row);
  }
  return rows;
}

// Every entry is imported as a one-off expense. Recurring rows carry a
// "Total Yearly" figure (column F) that already covers the whole financial
// year, so importing that single figure keeps each category's total equal to
// the spreadsheet's without the recurring job ever spawning extra rows.
export function parseSheetExpenses(rows, fallbackDate) {
  const entries = [];
  let mode = null; // 'recurring' | 'single'

  // Section marker text ("Recurring Payments" / "Single Payments") is
  // inconsistent across sheets (Home Rental uses a stray "." instead), so
  // detect the actual column-header rows by shape instead — those are
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
      const yearlyTotal = row[5];
      const perPeriod = row[4];
      // Prefer the yearly total; fall back to the per-period amount if the
      // sheet left column F blank.
      const amount = typeof yearlyTotal === 'number' && yearlyTotal > 0 ? yearlyTotal : perPeriod;
      if (itemName && typeof amount === 'number' && amount > 0) {
        entries.push({
          itemName: String(itemName).trim(),
          amount,
          currency: 'AUD',
          date: fallbackDate,
          rowNumber: row.rowNumber,
          source: 'recurring',
          note: frequency ? `Imported recurring total (${String(frequency).trim()})` : 'Imported recurring total',
        });
      }
    } else if (mode === 'single') {
      const dateSerial = row[0];
      const itemName = row[1];
      const currency = row[3];
      const amount = row[4];
      if (itemName && typeof amount === 'number' && amount > 0) {
        const date = typeof dateSerial === 'number' ? excelSerialToIso(dateSerial) : fallbackDate;
        entries.push({
          itemName: String(itemName).trim(),
          amount,
          currency: currency ? String(currency).trim() : 'AUD',
          date,
          rowNumber: row.rowNumber,
          source: 'single',
          note: null,
        });
      }
    }
  }

  return entries;
}

export function categoryForSheet(sheetName) {
  return CATEGORY_MAP[sheetName] || FALLBACK_CATEGORY;
}
