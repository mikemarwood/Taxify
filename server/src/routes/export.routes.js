import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import pool from '../db.js';
import { requireAuth, requireActiveAccess } from '../auth/middleware.js';
import { getVisibleUserIds, expenseScope } from '../auth/access.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { financialYearOf, isFinancialYearLabel } from '../lib/financialYear.js';
import { addBrandHeader, addFooter, BRAND } from '../lib/pdfBranding.js';
import { streamYearArchive } from '../lib/yearArchive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const router = Router();
router.use(requireAuth, requireActiveAccess);

async function loadExpenses(req) {
  const scope = await expenseScope(req.user);
  const [rows] = await pool.execute(
    `SELECT e.item_name, e.amount, e.currency, e.base_amount, e.base_currency, e.business_use_pct, e.purchase_date, e.is_recurring, e.frequency, e.notes,
            c.name AS category_name
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE ${scope.clause} AND e.deleted_at IS NULL
     ORDER BY e.purchase_date DESC, e.id DESC`,
    scope.params
  );
  return rows.map((r) => ({
    itemName: r.item_name,
    amount: Number(r.amount),
    baseAmount: r.base_amount === null ? null : Number(r.base_amount),
    baseCurrency: r.base_currency,
    businessUsePct: r.business_use_pct === null ? 100 : Number(r.business_use_pct),
    claimable: r.base_amount === null ? null : Math.round(Number(r.base_amount) * (Number(r.business_use_pct ?? 100) / 100) * 100) / 100,
    currency: r.currency,
    purchaseDate: r.purchase_date,
    financialYear: financialYearOf(r.purchase_date, req.user.financialYearRule),
    category: r.category_name || 'Uncategorised',
    recurring: r.is_recurring ? r.frequency : '',
    notes: r.notes || '',
  }));
}

function buildCategorySummary(expenses) {
  const categoryMap = new Map();
  const years = new Set();
  const cells = new Map();

  for (const e of expenses) {
    categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + (e.claimable || 0));
    years.add(e.financialYear);
    const key = `${e.category}|${e.financialYear}`;
    cells.set(key, (cells.get(key) || 0) + (e.claimable || 0));
  }

  const sortedCategories = Array.from(categoryMap.keys()).sort((a, b) => categoryMap.get(b) - categoryMap.get(a));
  const sortedYears = Array.from(years).sort();
  return { categories: sortedCategories, years: sortedYears, cells, totals: categoryMap };
}

router.get(
  '/expenses.xlsx',
  asyncHandler(async (req, res) => {
    const expenses = await loadExpenses(req);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Taxify';
    const sheet = workbook.addWorksheet('Expenses', { pageSetup: { fitToPage: true, fitToWidth: 1 } });
    sheet.headerFooter.oddHeader = '&R&14&BTaxify';

    sheet.mergeCells('A1:C1');
    sheet.getCell('A1').value = 'Expense report';
    sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0A0F18' } };
    sheet.getCell('A1').alignment = { vertical: 'middle' };
    sheet.mergeCells('D1:G1');
    sheet.getCell('D1').value = 'TAXIFY';
    sheet.getCell('D1').font = { bold: true, size: 14, color: { argb: 'FF2563EB' } };
    sheet.getCell('D1').alignment = { horizontal: 'right', vertical: 'middle' };
    sheet.getRow(1).height = 26;

    sheet.addRow([]);
    const headerRow = sheet.addRow(['Date', 'Item', 'Category', 'Amount', 'Currency', 'Converted', 'Business use %', 'Claimed', 'Recurring', 'Notes']);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      cell.alignment = { vertical: 'middle' };
    });

    let total = 0;
    expenses.forEach((e, i) => {
      total += e.claimable || 0;
      const row = sheet.addRow([
        new Date(e.purchaseDate).toLocaleDateString(),
        e.itemName,
        e.category,
        e.amount,
        e.currency,
        e.baseAmount === null ? 'needs a rate' : e.baseAmount,
        e.businessUsePct,
        e.claimable === null ? 'needs a rate' : e.claimable,
        e.recurring,
        e.notes,
      ]);
      row.getCell(4).numFmt = '#,##0.00';
      if (e.baseAmount !== null) row.getCell(6).numFmt = '#,##0.00';
      if (e.claimable !== null) row.getCell(8).numFmt = '#,##0.00';
      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        });
      }
    });

    // The total sums the converted column, so it is placed under it.
    // The total is of what is being claimed, so it sits under that column.
    const totalRow = sheet.addRow(['', '', 'Total', '', '', '', '', total]);
    totalRow.font = { bold: true };
    totalRow.getCell(8).numFmt = '#,##0.00';

    // Date, Item, Category, Amount, Currency, Converted, Recurring, Notes.
    // Date, Item, Category, Amount, Currency, Converted, Business use %,
    // Claimed, Recurring, Notes.
    sheet.columns = [
      { width: 13 },
      { width: 30 },
      { width: 18 },
      { width: 13 },
      { width: 9 },
      { width: 13 },
      { width: 14 },
      { width: 13 },
      { width: 12 },
      { width: 30 },
    ];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="taxify-expenses.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/expenses.pdf',
  asyncHandler(async (req, res) => {
    const expenses = await loadExpenses(req);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="taxify-expenses.pdf"');

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    doc.pipe(res);

    const columns = [
      { label: 'Date', width: 70 },
      { label: 'Item', width: 190 },
      { label: 'Category', width: 120 },
      { label: 'Amount', width: 70, align: 'right' },
      { label: 'Cur', width: 34 },
      { label: 'Use %', width: 42, align: 'right' },
      { label: 'Claimed', width: 74, align: 'right' },
      { label: 'Recurring', width: 56 },
      { label: 'Notes', width: 106 },
    ];

    function drawTableHeader(y) {
      let x = doc.page.margins.left;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
      doc.rect(x, y, columns.reduce((s, c) => s + c.width, 0), 20).fill(BRAND.blue);
      doc.fillColor('#ffffff');
      for (const col of columns) {
        doc.text(col.label, x + 4, y + 6, { width: col.width - 8, align: col.align || 'left' });
        x += col.width;
      }
      return y + 20;
    }

    let y = addBrandHeader(doc, { title: 'Expense report', subtitle: `${expenses.length} entries` });
    y = drawTableHeader(y);

    let total = 0;
    doc.font('Helvetica').fontSize(9);
    expenses.forEach((e, i) => {
      total += e.claimable || 0;
      if (y > doc.page.height - doc.page.margins.bottom - 30) {
        addFooter(doc);
        doc.addPage();
        y = addBrandHeader(doc, { title: 'Expense report (cont.)' });
        y = drawTableHeader(y);
        doc.font('Helvetica').fontSize(9);
      }
      let x = doc.page.margins.left;
      if (i % 2 === 1) {
        doc.rect(x, y, columns.reduce((s, c) => s + c.width, 0), 18).fill('#f3f4f6');
      }
      doc.fillColor(BRAND.ink);
      const values = [
        new Date(e.purchaseDate).toLocaleDateString(),
        e.itemName,
        e.category,
        e.amount.toFixed(2),
        e.currency,
        String(e.businessUsePct ?? 100),
        e.claimable === null ? 'needs rate' : e.claimable.toFixed(2),
        e.recurring,
        e.notes,
      ];
      values.forEach((v, idx) => {
        const col = columns[idx];
        doc.text(String(v), x + 4, y + 4, { width: col.width - 8, align: col.align || 'left', ellipsis: true });
        x += col.width;
      });
      y += 18;
    });

    doc.font('Helvetica-Bold').fontSize(10).text(`Total: ${total.toFixed(2)}`, doc.page.margins.left, y + 10);
    addFooter(doc);
    doc.end();
  })
);

router.get(
  '/categories.xlsx',
  asyncHandler(async (req, res) => {
    const expenses = await loadExpenses(req);
    const { categories, years, cells, totals } = buildCategorySummary(expenses);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Taxify';
    const sheet = workbook.addWorksheet('Category summary');
    const totalCols = years.length + 2; // Category + one per year + Total

    sheet.getCell(1, 1).value = 'Category summary';
    sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF0A0F18' } };
    const brandCell = sheet.getCell(1, totalCols);
    brandCell.value = 'TAXIFY';
    brandCell.font = { bold: true, size: 14, color: { argb: 'FF2563EB' } };
    brandCell.alignment = { horizontal: 'right' };
    sheet.getRow(1).height = 26;
    sheet.addRow([]);

    const headerRow = sheet.addRow(['Category', ...years.map((y) => `FY ${y}`), 'Total']);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    });

    categories.forEach((cat, i) => {
      const row = sheet.addRow([
        cat,
        ...years.map((y) => cells.get(`${cat}|${y}`) || 0),
        totals.get(cat) || 0,
      ]);
      row.eachCell((cell, colNumber) => {
        if (colNumber > 1) cell.numFmt = '#,##0.00';
        if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      });
    });

    const grandTotal = Array.from(totals.values()).reduce((s, v) => s + v, 0);
    const totalRow = sheet.addRow(['Total', ...years.map((y) => {
      let sum = 0;
      for (const cat of categories) sum += cells.get(`${cat}|${y}`) || 0;
      return sum;
    }), grandTotal]);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = '#,##0.00';
    });

    sheet.columns = [{ width: 24 }, ...years.map(() => ({ width: 14 })), { width: 14 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="taxify-category-summary.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/categories.pdf',
  asyncHandler(async (req, res) => {
    const expenses = await loadExpenses(req);
    const { categories, years, cells, totals } = buildCategorySummary(expenses);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="taxify-category-summary.pdf"');

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    const catWidth = 150;
    const yearWidth = Math.min(80, (doc.page.width - doc.page.margins.left - doc.page.margins.right - catWidth - 80) / Math.max(years.length, 1));

    function drawTableHeader(y) {
      let x = doc.page.margins.left;
      const totalWidth = catWidth + yearWidth * years.length + 80;
      doc.rect(x, y, totalWidth, 20).fill(BRAND.blue);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
      doc.text('Category', x + 4, y + 6, { width: catWidth - 8 });
      x += catWidth;
      for (const yr of years) {
        doc.text(`FY ${yr}`, x + 4, y + 6, { width: yearWidth - 8, align: 'right' });
        x += yearWidth;
      }
      doc.text('Total', x + 4, y + 6, { width: 72, align: 'right' });
      return y + 20;
    }

    let y = addBrandHeader(doc, { title: 'Category summary', subtitle: `${categories.length} categories` });
    y = drawTableHeader(y);

    doc.font('Helvetica').fontSize(9);
    categories.forEach((cat, i) => {
      if (y > doc.page.height - doc.page.margins.bottom - 30) {
        addFooter(doc);
        doc.addPage();
        y = addBrandHeader(doc, { title: 'Category summary (cont.)' });
        y = drawTableHeader(y);
        doc.font('Helvetica').fontSize(9);
      }
      let x = doc.page.margins.left;
      const totalWidth = catWidth + yearWidth * years.length + 80;
      if (i % 2 === 1) doc.rect(x, y, totalWidth, 18).fill('#f3f4f6');
      doc.fillColor(BRAND.ink);
      doc.text(cat, x + 4, y + 4, { width: catWidth - 8, ellipsis: true });
      x += catWidth;
      for (const yr of years) {
        const val = cells.get(`${cat}|${yr}`) || 0;
        doc.text(val ? val.toFixed(2) : '—', x + 4, y + 4, { width: yearWidth - 8, align: 'right' });
        x += yearWidth;
      }
      doc.text((totals.get(cat) || 0).toFixed(2), x + 4, y + 4, { width: 72, align: 'right' });
      y += 18;
    });

    const grandTotal = Array.from(totals.values()).reduce((s, v) => s + v, 0);
    doc.font('Helvetica-Bold').fontSize(10).text(`Grand total: ${grandTotal.toFixed(2)}`, doc.page.margins.left, y + 10);
    addFooter(doc);
    doc.end();
  })
);

// The whole year as a zip: spreadsheet, PDF, and every attachment in folders.
// Built for handing to an accountant, so the receipts are real files rather
// than links back into an app they can't sign into.
router.get(
  '/year/:financialYear.zip',
  asyncHandler(async (req, res) => {
    const { financialYear } = req.params;
    if (!isFinancialYearLabel(financialYear)) {
      return res.status(400).json({ error: 'Expected a financial year like 2025-2026' });
    }

    const scope = await expenseScope(req.user);
    const [rows] = await pool.execute(
      `SELECT e.id, e.user_id, e.item_name, e.amount, e.currency, e.base_amount, e.base_currency, e.business_use_pct, e.purchase_date, e.receipt_path,
              e.is_recurring, e.frequency, e.notes, c.name AS category_name
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE ${scope.clause} AND e.deleted_at IS NULL
       ORDER BY e.purchase_date ASC, e.id ASC`,
      scope.params
    );

    const expenses = rows
      .map((r) => ({
        id: r.id,
        ownerId: r.user_id,
        itemName: r.item_name,
        amount: Number(r.amount),
        baseAmount: r.base_amount === null ? null : Number(r.base_amount),
        baseCurrency: r.base_currency,
        businessUsePct: r.business_use_pct === null ? 100 : Number(r.business_use_pct),
        claimable: r.base_amount === null ? null : Math.round(Number(r.base_amount) * (Number(r.business_use_pct ?? 100) / 100) * 100) / 100,
    businessUsePct: r.business_use_pct === null ? 100 : Number(r.business_use_pct),
    claimable: r.base_amount === null ? null : Math.round(Number(r.base_amount) * (Number(r.business_use_pct ?? 100) / 100) * 100) / 100,
    baseAmount: r.base_amount === null ? null : Number(r.base_amount),
    baseCurrency: r.base_currency,
    businessUsePct: r.business_use_pct === null ? 100 : Number(r.business_use_pct),
    claimable: r.base_amount === null ? null : Math.round(Number(r.base_amount) * (Number(r.business_use_pct ?? 100) / 100) * 100) / 100,
        currency: r.currency,
        purchaseDate: r.purchase_date,
        category: r.category_name || 'Uncategorised',
        recurring: r.is_recurring ? r.frequency : '',
        notes: r.notes || '',
        receiptFilename: r.receipt_path || null,
      }))
      .filter((e) => financialYearOf(e.purchaseDate, req.user.financialYearRule) === financialYear);

    if (expenses.length === 0) {
      return res.status(404).json({ error: `Nothing recorded in FY ${financialYear} yet` });
    }

    const [categories] = await pool.execute('SELECT name, is_property_rental FROM categories WHERE user_id = ?', [
      req.user.id,
    ]);

    await streamYearArchive({ res, uploadsDir, userId: req.user.id, financialYear, expenses, categories, rule: req.user.financialYearRule });
  })
);

export default router;
