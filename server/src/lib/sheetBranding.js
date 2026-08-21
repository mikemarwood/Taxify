import { brandLogoPng } from './brandLogo.js';

// The letterhead and table styling for the spreadsheet exports.
//
// What was here before was the word "TAXIFY" typed into the top-right cell in
// #2563EB, a blue the product does not use, with the table headed in navy —
// two colours, neither of them the brand's. A spreadsheet can hold the actual
// mark, so it holds the actual mark.
//
// Excel wants colours as ARGB, so they are written out that way once here
// rather than spelled again at every call site.
export const ARGB = {
  blue: 'FF1559B8',
  blueDark: 'FF0F3F8A',
  ink: 'FF0A0F18',
  muted: 'FF6B7280',
  white: 'FFFFFFFF',
  zebra: 'FFF6F8FC',
  rule: 'FFD8DFEA',
};

// Puts the mark, the wordmark, the report title and a subtitle across the top
// of a sheet, and returns the row number the table should start on.
//
// The mark floats over the last column rather than sitting in a cell, because
// an image in a spreadsheet always floats — it is anchored to a position, not
// stored in a cell — so the cells underneath are left empty for it.
export function addSheetBranding(workbook, sheet, { title, subtitle, columns }) {
  const lastCol = Math.max(columns, 1);

  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: ARGB.ink } };
  sheet.getRow(1).height = 24;

  if (subtitle) {
    sheet.getCell(2, 1).value = subtitle;
    sheet.getCell(2, 1).font = { size: 10, color: { argb: ARGB.muted } };
  }
  sheet.getRow(2).height = 16;

  // The wordmark under the mark, right-aligned, so the two read as one lockup
  // in the corner. Only when there is a column spare to put it in — with a
  // single year the sheet is three columns wide and the title needs them.
  if (lastCol >= 3) {
    const wordmark = sheet.getCell(2, lastCol);
    wordmark.value = 'Taxify';
    wordmark.font = { bold: true, size: 11, color: { argb: ARGB.blue } };
    wordmark.alignment = { horizontal: 'right' };
  }

  const logo = brandLogoPng();
  if (logo) {
    const imageId = workbook.addImage({ buffer: logo, extension: 'png' });
    // Fractional anchors nudge it off the cell's own corner so it is not
    // jammed against the gridline. Rows are zero-based here, unlike getCell.
    sheet.addImage(imageId, {
      tl: { col: lastCol - 0.55, row: 0.1 },
      ext: { width: 26, height: 26 },
      editAs: 'oneCell',
    });
  }

  // A blank row, so the table is not welded to the letterhead.
  return 4;
}

// One look for every table in the exports: a brand-blue head, quiet zebra
// striping, a ruled total row, and the head frozen so the columns still say
// what they are two hundred rows down.
export function styleSheetTable(sheet, { headerRow, firstDataRow, lastDataRow, totalRow, numberFrom = 2 }) {
  const head = sheet.getRow(headerRow);
  head.height = 20;
  head.eachCell((cell, col) => {
    cell.font = { bold: true, size: 11, color: { argb: ARGB.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.blue } };
    cell.alignment = { vertical: 'middle', horizontal: col >= numberFrom ? 'right' : 'left' };
  });

  for (let r = firstDataRow; r <= lastDataRow; r++) {
    const row = sheet.getRow(r);
    const striped = (r - firstDataRow) % 2 === 1;
    row.eachCell((cell, col) => {
      if (col >= numberFrom) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
      if (striped) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.zebra } };
    });
  }

  if (totalRow) {
    const row = sheet.getRow(totalRow);
    row.eachCell((cell, col) => {
      cell.font = { bold: true, color: { argb: ARGB.ink } };
      cell.border = { top: { style: 'thin', color: { argb: ARGB.rule } } };
      if (col >= numberFrom) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
    });
  }

  // Scrolling a summary past its own headings is the main way these get
  // misread, and it costs one line to prevent.
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
}
