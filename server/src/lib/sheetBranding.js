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
export function addSheetBranding(workbook, sheet, { title, subtitle }) {
  // A letterhead, read top-left to bottom-right like everything else.
  //
  // The mark used to be anchored over the last column, which put it alone in
  // the far top-right of the sheet with the word "Taxify" underneath it — a
  // small icon floating in an empty cell several columns from anything, which
  // read as something pasted in by accident rather than as branding. It sits
  // at the front now, on the same line as the name, with the report title
  // under it.
  //
  // The name is indented past the image rather than put in the next column,
  // because the next column is a data column of whatever width the table
  // needs and the gap would be enormous.
  const brand = sheet.getCell(1, 1);
  brand.value = 'Taxify';
  brand.font = { bold: true, size: 13, color: { argb: ARGB.blue } };
  brand.alignment = { vertical: 'middle', indent: 4 };
  sheet.getRow(1).height = 26;

  sheet.getCell(2, 1).value = title;
  sheet.getCell(2, 1).font = { bold: true, size: 16, color: { argb: ARGB.ink } };
  sheet.getRow(2).height = 22;

  if (subtitle) {
    sheet.getCell(3, 1).value = subtitle;
    sheet.getCell(3, 1).font = { size: 10, color: { argb: ARGB.muted } };
  }
  sheet.getRow(3).height = 15;

  const logo = brandLogoPng();
  if (logo) {
    const imageId = workbook.addImage({ buffer: logo, extension: 'png' });
    // Fractional anchors keep it off the gridline. Rows and columns are
    // zero-based here, unlike getCell.
    sheet.addImage(imageId, {
      tl: { col: 0.08, row: 0.12 },
      ext: { width: 22, height: 22 },
      editAs: 'oneCell',
    });
  }

  // A blank row, so the table is not welded to the letterhead.
  return 5;
}

// One look for every table in the exports: a brand-blue head, quiet zebra
// striping, a ruled total row, and the head frozen so the columns still say
// what they are two hundred rows down.
// moneyFormat is passed in rather than fixed here, because it carries the
// account's currency symbol. It used to be a hard-coded '#,##0.00' set after
// the caller had already applied its own format — so the caller's was silently
// overwritten and every column came out as a bare number.
export function styleSheetTable(
  sheet,
  { headerRow, firstDataRow, lastDataRow, totalRow, numberFrom = 2, moneyFormat = '#,##0.00' }
) {
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
        cell.numFmt = moneyFormat;
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
        cell.numFmt = moneyFormat;
        cell.alignment = { horizontal: 'right' };
      }
    });
  }

  // Scrolling a summary past its own headings is the main way these get
  // misread, and it costs one line to prevent.
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
}
