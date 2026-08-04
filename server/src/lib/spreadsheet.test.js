import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

// Guards the uuid override in package.json.
//
// exceljs pulls in uuid 8, which carries an advisory, so package.json forces
// uuid 11 instead. exceljs only ever calls v4() and that signature has not
// changed, but "should be fine" is not the same as knowing — and a dependency
// override is precisely the kind of thing that breaks quietly on some future
// install, months after anyone remembers it exists.
//
// Everything goes through a buffer rather than a file: the point is the
// library, not the disk, and a test that writes files needs cleaning up.

test('a workbook survives being written and read back', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Expenses');
  sheet.columns = [
    { header: 'Item', key: 'item', width: 30 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Date', key: 'date', width: 14 },
  ];
  sheet.addRow({ item: 'Laptop', amount: 2000, date: '2026-03-14' });
  sheet.addRow({ item: 'Coffee with a client', amount: 12.5, date: '2026-04-02' });
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn('amount').numFmt = '#,##0.00';

  const buffer = await wb.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 0, 'the export produced nothing');

  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  const read = back.getWorksheet('Expenses');

  assert.equal(read.rowCount, 3, 'header plus two rows');
  assert.equal(read.getRow(1).getCell(1).value, 'Item');
  assert.equal(read.getRow(2).getCell(1).value, 'Laptop');

  // Amounts must come back as numbers. A spreadsheet of text that looks like
  // money is worse than no spreadsheet: it sums to zero without complaining.
  const total = read.getRow(2).getCell(2).value + read.getRow(3).getCell(2).value;
  assert.equal(total, 2012.5);
});

test('cents are not lost on the way through', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Cents');
  sheet.addRow([0.1]);
  sheet.addRow([0.2]);

  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  const read = back.getWorksheet('Cents');

  assert.equal(read.getRow(1).getCell(1).value, 0.1);
  assert.equal(read.getRow(2).getCell(1).value, 0.2);
});
