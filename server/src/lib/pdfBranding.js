// The Taxify mark, drawn rather than imported.
//
// PDFKit takes vectors, and the logo is already vectors — client/public/logo.svg
// — so this reproduces that file's geometry instead of embedding a raster of
// it. Everything below is on the SVG's own 128x128 grid and scaled, so the two
// can be compared side by side and kept honest: change one, change the other.
//
// What was here before was not the logo. It drew a horizontal bar, a vertical
// bar and a dot in a blue-to-cyan gradient — a mark that has never appeared
// anywhere else in the product, in colours the brand does not use.

const BRAND = {
  // Straight off logo.svg's gradient stops.
  blue: '#1559b8',
  blueLight: '#1e6ad4',
  blueDark: '#0f3f8a',
  // The pale blue of the upper arrow.
  arrow: '#7cb8ff',
  ink: '#0a0f18',
  muted: '#6b7280',
  border: '#e5e7eb',
  white: '#ffffff',
};

// logo.svg's viewBox. Every coordinate below is expressed in it.
const GRID = 128;

function drawLogoMark(doc, x, y, size) {
  const s = size / GRID;
  const at = (n) => n * s;

  // The rounded square, with the same three-stop gradient running corner to
  // corner as the SVG's linearGradient.
  const gradient = doc.linearGradient(x, y, x + size, y + size);
  gradient.stop(0, BRAND.blueLight).stop(0.55, BRAND.blue).stop(1, BRAND.blueDark);
  doc.roundedRect(x, y, size, size, at(26)).fill(gradient);

  // Money out, money back. The two arrows are a 180° rotation of each other
  // about the centre, so the mark is balanced either way up.
  const arrow = (rectX, rectY, tip, back, midY, colour) => {
    doc.roundedRect(x + at(rectX), y + at(rectY), at(50), at(13), at(6.5)).fill(colour);
    doc
      .moveTo(x + at(back), y + at(midY - 16.5))
      .lineTo(x + at(tip), y + at(midY))
      .lineTo(x + at(back), y + at(midY + 16.5))
      .fill(colour);
  };

  arrow(30, 40, 100, 74, 46.5, BRAND.arrow);
  arrow(48, 76, 28, 54, 82.5, BRAND.white);
}

// The brand lockup — mark plus wordmark — as one unit, so a caller only has to
// decide where it goes. Returns how wide it came out.
function drawLockup(doc, x, y, markSize) {
  drawLogoMark(doc, x, y, markSize);
  const gap = markSize * 0.34;
  const textX = x + markSize + gap;

  doc.font('Helvetica-Bold').fontSize(markSize * 0.72).fillColor(BRAND.ink);
  // A shade of tracking, because the wordmark is set tight everywhere else and
  // Helvetica at this size otherwise reads loose beside the mark.
  doc.text('Taxify', textX, y + markSize * 0.24, { characterSpacing: -0.4, lineBreak: false });

  return markSize + gap + doc.widthOfString('Taxify');
}

// Letterhead: the lockup at the left where a logo belongs, the report's own
// title set against it on the right, and a rule under both. Returns the
// y-coordinate content should start below.
export function addBrandHeader(doc, { title, subtitle }) {
  const { width, margins } = doc.page;
  const left = margins.left;
  const right = width - margins.right;
  const markSize = 26;
  const top = 34;

  drawLockup(doc, left, top, markSize);

  // Right-aligned against the lockup rather than stacked under it: a summary
  // is read for its title, and this keeps the header to one band.
  const titleWidth = (right - left) * 0.55;
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(BRAND.ink)
    .text(title, right - titleWidth, top + 1, { width: titleWidth, align: 'right', lineBreak: false });
  if (subtitle) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(subtitle, right - titleWidth, top + 19, { width: titleWidth, align: 'right', lineBreak: false });
  }

  // Two rules on the same line: a short brand-blue one under the lockup, and a
  // hairline carrying on to the margin. Cheap, and it makes the band look set
  // rather than merely divided.
  const ruleY = top + markSize + 13;
  const accentWidth = 46;
  doc.rect(left, ruleY, accentWidth, 2).fill(BRAND.blue);
  doc
    .moveTo(left + accentWidth + 5, ruleY + 1)
    .lineTo(right, ruleY + 1)
    .strokeColor(BRAND.border)
    .lineWidth(1)
    .stroke();

  return ruleY + 20;
}

export function addFooter(doc) {
  const { width, height, margins } = doc.page;
  const y = height - margins.bottom + 14;
  const right = width - margins.right;

  doc
    .moveTo(margins.left, y - 6)
    .lineTo(right, y - 6)
    .strokeColor(BRAND.border)
    .lineWidth(0.5)
    .stroke();

  // The mark again at the size of the type beside it, so the foot is signed
  // rather than merely captioned.
  drawLogoMark(doc, margins.left, y, 9);
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(BRAND.muted)
    .text('Taxify', margins.left + 12, y + 1, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(BRAND.muted)
    .text(new Date().toLocaleDateString(), right - 120, y + 1, { width: 120, align: 'right', lineBreak: false });
}

export { BRAND };
