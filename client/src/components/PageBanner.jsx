import Icon from './Icon.jsx';

// The header every page opens with: a pale band carrying the page's name, one
// line saying what it is for, and up to three chips.
//
// Lifted out of Add expense, which had it first. Every other page opened with a
// bare h1 on the page's own background, so moving between them the top of the
// screen kept changing shape — one page with a banner and six without reads as
// six pages from different products.
//
// The artwork is optional and only Add expense has one. A band without it is
// the same band, which is the point: the shape is what makes the set, not the
// picture.
const TINTS = {
  blue: 'linear-gradient(140deg, #2f8bf4, #1559b8)',
  green: 'linear-gradient(140deg, #23a866, #0c7343)',
  violet: 'linear-gradient(140deg, #9a6ae8, #6d3fc4)',
  amber: 'linear-gradient(140deg, #f0913a, #cf6a11)',
};

export default function PageBanner({ title, blurb, chips = [], art, artAlt = '', actions }) {
  return (
    <div className="ae-banner">
      <div className="ae-banner-copy">
        <h1>{title}</h1>
        {blurb && <p>{blurb}</p>}

        {chips.length > 0 && (
          <div className="ae-chips">
            {chips.map((c) => (
              <span className="ae-chip" key={c.title}>
                <span className="ae-chip-mark" style={{ background: TINTS[c.tint] || TINTS.blue }}>
                  <Icon name={c.icon} size={13} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{c.title}</b>
                  <span>{c.text}</span>
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* The controls that belong to the page as a whole — a year to report on,
          a thing to export, a thing to add. They were above the banner or
          floating beside a heading; in it, they are plainly the page's. */}
      {actions && <div className="ae-banner-actions">{actions}</div>}

      {art && <img className="ae-banner-art" src={art} alt={artAlt} width="717" height="724" />}
    </div>
  );
}
