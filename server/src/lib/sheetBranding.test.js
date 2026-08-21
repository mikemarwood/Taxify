import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { addSheetBranding, styleSheetTable, ARGB } from './sheetBranding.js';
import { brandLogoPng } from './brandLogo.js';

// Builds the same shape the category export builds, so the row arithmetic is
// checked rather than assumed. Getting it wrong styles the wrong rows, and
// that is invisible until somebody opens the file.
function buildSheet({ years = ['2025-2026', '2026-2027'], categories = ['Home Rental', 'General', 'Tooling'] } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Category summary');
  const totalCols = years.length + 2;

  sheet.columns = [{ width: 26 }, ...years.map(() => ({ width: 15 })), { width: 15 }];

  const headerRow = addSheetBranding(workbook, sheet, {
    title: 'Category summary',
    subtitle: 'a subtitle',
    columns: totalCols,
  });

  while (sheet.rowCount < headerRow - 1) sheet.addRow([]);
  sheet.addRow(['Category', ...years.map((y) => `FY ${y}`), 'Total']);

  const firstDataRow = headerRow + 1;
  categories.forEach((cat, i) => sheet.addRow([cat, ...years.map(() => i + 1), (i + 1) * years.length]));
  const lastDataRow = firstDataRow + categories.length - 1;
  sheet.addRow(['Total', ...years.map(() => 6), 12]);

  styleSheetTable(sheet, { headerRow, firstDataRow, lastDataRow, totalRow: lastDataRow + 1 });
  return { workbook, sheet, headerRow, firstDataRow, lastDataRow, totalCols };
}

test('the heading row really is where the caller was told it is', () => {
  const { sheet, headerRow } = buildSheet();
  assert.equal(sheet.getCell(headerRow, 1).value, 'Category');
  assert.equal(sheet.getCell(headerRow, 2).value, 'FY 2025-2026');
});

test('data starts under the heading, not on it', () => {
  const { sheet, firstDataRow, lastDataRow } = buildSheet();
  assert.equal(sheet.getCell(firstDataRow, 1).value, 'Home Rental');
  assert.equal(sheet.getCell(lastDataRow, 1).value, 'Tooling');
  assert.equal(sheet.getCell(lastDataRow + 1, 1).value, 'Total');
});

test('the heading is filled in the brand blue, not the old navy', () => {
  const { sheet, headerRow } = buildSheet();
  const cell = sheet.getCell(headerRow, 1);
  assert.equal(cell.fill.fgColor.argb, ARGB.blue);
  assert.equal(cell.font.color.argb, ARGB.white);
});

test('money columns are formatted as money and the label column is not', () => {
  const { sheet, firstDataRow } = buildSheet();
  assert.equal(sheet.getCell(firstDataRow, 2).numFmt, '#,##0.00');
  assert.equal(sheet.getCell(firstDataRow, 1).numFmt, undefined);
});

test('the total row is ruled off and bold', () => {
  const { sheet, lastDataRow } = buildSheet();
  const total = sheet.getCell(lastDataRow + 1, 1);
  assert.equal(total.font.bold, true);
  assert.ok(total.border.top, 'the total row needs a rule above it');
});

test('the headings stay put when the sheet is scrolled', () => {
  const { sheet, headerRow } = buildSheet();
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, headerRow);
});

test('the mark is embedded, not typed', () => {
  const { workbook, sheet } = buildSheet();
  assert.ok(brandLogoPng(), 'the logo file must be readable from the server');
  assert.equal(workbook.model.media.length, 1);
  assert.equal(workbook.model.media[0].extension, 'png');
  assert.equal(sheet.getImages().length, 1);
});

test('the wordmark sits in the last column beside the mark', () => {
  const { sheet, totalCols } = buildSheet();
  assert.equal(sheet.getCell(2, totalCols).value, 'Taxify');
});

test('a narrow sheet drops the wordmark rather than writing over the title', () => {
  // One year is three columns, and the title needs them.
  const { sheet } = buildSheet({ years: ['2026-2027'] });
  assert.equal(sheet.getCell(1, 1).value, 'Category summary');
  assert.notEqual(sheet.getCell(2, 2).value, 'Taxify');
});

test('the whole workbook writes without throwing', async () => {
  const { workbook } = buildSheet();
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 2000, 'a real xlsx is more than a couple of KB');
  // xlsx is a zip; "PK" is the local file header every one of them starts with.
  assert.equal(Buffer.from(buffer).slice(0, 2).toString('latin1'), 'PK');
});

test('and reads back with the image intact', async () => {
  const { workbook } = buildSheet();
  const buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  const sheet = reopened.getWorksheet('Category summary');
  assert.equal(sheet.getImages().length, 1, 'the logo must survive a round trip');
  assert.equal(sheet.getCell(1, 1).value, 'Category summary');
});
