import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { ZipArchive } from 'archiver';
import { receiptDirFor, categoryToFolderSegment, categoryDocumentDir } from './receiptStorage.js';
import { addBrandHeader, addFooter } from './pdfBranding.js';
import { financialYearRange } from './financialYear.js';

// A whole financial year as one zip: the spreadsheet, a PDF of the same
// figures, and every attachment filed in folders. Built for handing to an
// accountant, which is why the receipts are real files in a folder tree rather
// than links back into an app they don't have a login for.
//
// Streamed rather than assembled in memory — a year of receipts is easily
// hundreds of megabytes, and buffering that per request is how a small server
// falls over.

const FOLDER = 'Receipts';
const DOCS_FOLDER = 'Property Documents';

export function archiveName(financialYear) {
  const range = financialYearRange(financialYear);
  if (!range) return `Taxify Summary ${financialYear}`;
  const fmt = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
  };
  return `Taxify Summary ${fmt(range.start)} to ${fmt(range.end)}`;
}

// Windows and Excel both dislike these in a path, and a hyperlink to a file
// with one in the name silently fails to open.
function safeFileSegment(raw) {
  return String(raw || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// Where each receipt lands inside the zip, and what the spreadsheet links to.
// Named after the expense rather than kept as its stored filename, because
// "bunnings-invoice-2.pdf" means nothing in a folder of ninety receipts.
function receiptEntryFor(expense, taken) {
  const ext = path.extname(expense.receiptFilename) || '';
  const base = safeFileSegment(
    `${String(expense.purchaseDate).slice(0, 10)} ${expense.itemName} ${expense.amount.toFixed(2)}`
  );
  let name = `${base}${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})${ext}`;
  taken.add(name);
  return `${FOLDER}/${safeFileSegment(expense.category)}/${name}`;
}

async function buildWorkbook(financialYear, expenses, entries, totals) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Taxify';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`FY ${financialYear}`);
  sheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Item', key: 'item', width: 40 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Recurring', key: 'recurring', width: 12 },
    { header: 'Notes', key: 'notes', width: 36 },
    { header: 'Receipt', key: 'receipt', width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const expense of expenses) {
    const row = sheet.addRow({
      date: String(expense.purchaseDate).slice(0, 10),
      item: expense.itemName,
      category: expense.category,
      amount: expense.amount,
      currency: expense.currency || 'AUD',
      recurring: expense.recurring || '',
      notes: expense.notes || '',
      receipt: entries.get(expense.id) ? 'View Receipt' : '',
    });
    row.getCell('amount').numFmt = '#,##0.00';

    // A relative hyperlink, so it resolves against wherever the zip was
    // extracted. An absolute path would only work on the machine that made it.
    const entry = entries.get(expense.id);
    if (entry) {
      const cell = row.getCell('receipt');
      cell.value = { text: 'View Receipt', hyperlink: entry.split('/').map(encodeURIComponent).join('/') };
      cell.font = { color: { argb: 'FF1559B8' }, underline: true };
    }
  }

  sheet.addRow({});
  const totalRow = sheet.addRow({ item: 'TOTAL', amount: totals.grand });
  totalRow.font = { bold: true };
  totalRow.getCell('amount').numFmt = '#,##0.00';
  sheet.autoFilter = { from: 'A1', to: 'H1' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const summary = workbook.addWorksheet('By category');
  summary.columns = [
    { header: 'Category', key: 'category', width: 30 },
    { header: 'Entries', key: 'count', width: 12 },
    { header: 'Total', key: 'total', width: 16 },
  ];
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  for (const [category, figures] of totals.byCategory) {
    const row = summary.addRow({ category, count: figures.count, total: figures.total });
    row.getCell('total').numFmt = '#,##0.00';
  }

  return workbook.xlsx.writeBuffer();
}

function buildPdf(financialYear, expenses, totals) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    addBrandHeader(doc, { title: 'Expense summary', subtitle: `Financial year ${financialYear}` });

    doc.moveDown(0.5).fontSize(10).fillColor('#4b5563');
    doc.text(`${expenses.length} entries · total ${totals.grand.toFixed(2)}`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111827').text('By category', { underline: false });
    doc.moveDown(0.4);
    doc.fontSize(10);
    for (const [category, figures] of totals.byCategory) {
      doc.fillColor('#374151').text(category, { continued: true });
      doc.fillColor('#111827').text(`   ${figures.total.toFixed(2)}   (${figures.count})`, { align: 'right' });
    }

    doc.moveDown(1.2);
    doc.fontSize(12).fillColor('#111827').text('All entries');
    doc.moveDown(0.4).fontSize(9);

    for (const expense of expenses) {
      if (doc.y > 760) doc.addPage();
      const date = String(expense.purchaseDate).slice(0, 10);
      doc.fillColor('#6b7280').text(`${date}  `, { continued: true });
      doc.fillColor('#111827').text(expense.itemName, { continued: true });
      doc.fillColor('#6b7280').text(`  ${expense.category}`, { continued: true });
      doc.fillColor('#111827').text(`  ${expense.amount.toFixed(2)}`, { align: 'right' });
    }

    addFooter(doc);
    doc.end();
  });
}

// Streams the zip straight to the response.
export async function streamYearArchive({ res, uploadsDir, userId, financialYear, expenses, categories }) {
  const totals = { grand: 0, byCategory: new Map() };
  for (const e of expenses) {
    totals.grand += e.amount;
    const figures = totals.byCategory.get(e.category) || { total: 0, count: 0 };
    figures.total += e.amount;
    figures.count += 1;
    totals.byCategory.set(e.category, figures);
  }
  totals.byCategory = new Map([...totals.byCategory.entries()].sort((a, b) => b[1].total - a[1].total));

  // Work out every receipt's place in the zip first, so the spreadsheet's
  // links and the files it points at can't disagree.
  const entries = new Map();
  const takenNames = new Map();
  for (const expense of expenses) {
    if (!expense.receiptFilename) continue;
    const dir = receiptDirFor(uploadsDir, expense.ownerId, expense.purchaseDate, expense.category);
    const source = path.join(dir, expense.receiptFilename);
    if (!fs.existsSync(source)) continue;

    const key = safeFileSegment(expense.category);
    if (!takenNames.has(key)) takenNames.set(key, new Set());
    const entry = receiptEntryFor(expense, takenNames.get(key));
    entries.set(expense.id, entry);
    expense._source = source;
  }

  const name = archiveName(financialYear);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('warning', (err) => console.error('Archive warning', err));
  archive.on('error', (err) => {
    console.error('Archive failed', err);
    res.destroy(err);
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
  archive.pipe(res);

  archive.append(await buildWorkbook(financialYear, expenses, entries, totals), { name: `${name}.xlsx` });
  archive.append(await buildPdf(financialYear, expenses, totals), { name: `${name}.pdf` });

  for (const expense of expenses) {
    const entry = entries.get(expense.id);
    if (entry && expense._source) archive.file(expense._source, { name: entry });
  }

  // Property-rental paperwork for the same year, kept beside the receipts.
  for (const category of categories) {
    if (!category.is_property_rental) continue;
    const dir = categoryDocumentDir(uploadsDir, userId, category.name, financialYear);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      if (fs.statSync(full).isFile()) {
        archive.file(full, { name: `${DOCS_FOLDER}/${safeFileSegment(category.name)}/${file}` });
      }
    }
  }

  // A note in the archive itself, since the person opening it may not be the
  // person who made it.
  archive.append(
    [
      `Taxify export — financial year ${financialYear}`,
      `Generated ${new Date().toISOString().slice(0, 10)}`,
      '',
      `${expenses.length} expenses, total ${totals.grand.toFixed(2)}`,
      `${entries.size} receipts attached`,
      '',
      'The spreadsheet has a "View Receipt" link on every row that has one.',
      'Those links are relative, so keep this folder structure intact after',
      'extracting and they will open the file directly.',
      '',
      `Folders:  ${FOLDER}/<category>/   ${DOCS_FOLDER}/<property>/`,
    ].join('\n'),
    { name: 'README.txt' }
  );

  await archive.finalize();
  return { entryCount: entries.size, total: totals.grand };
}
