import { claimable, formatMoney, fullAmount, isApportioned, isForeign } from '../lib/money.js';

// An expense's figure, shown so that a column of them visibly adds up to the
// total above it — which means showing the converted amount, in the account's
// own currency.
//
// The original is not thrown away, though: the receipt says EUR 500, and an
// accountant checking a line against a docket needs to see that. It sits
// underneath, with the rate it was converted at.
export default function Amount({ expense, align = 'right', style }) {
  const foreign = isForeign(expense);
  const apportioned = isApportioned(expense);
  const missing = expense?.baseAmount === null;

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', ...style }}>
      <span style={{ fontWeight: 700, color: missing ? 'var(--amber)' : undefined }}>
        {missing ? formatMoney(expense.amount, expense.currency) : formatMoney(claimable(expense), expense?.baseCurrency)}
      </span>

      {missing ? (
        <span style={{ fontSize: 10.5, color: 'var(--amber)', fontWeight: 600 }}>needs a rate</span>
      ) : (
        <>
          {/* Part-business expenses show what was actually spent beside what
              is being claimed — the receipt and the claim are different
              numbers and confusing them is the whole risk here. */}
          {apportioned && (
            <span
              title={`${expense.businessUsePct}% business use of ${formatMoney(fullAmount(expense), expense.baseCurrency)}`}
              style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 500 }}
            >
              {expense.businessUsePct}% of {formatMoney(fullAmount(expense), expense.baseCurrency)}
            </span>
          )}
          {foreign && (
            <span
              title={expense.fxRate ? `Converted at ${expense.fxRate} (${expense.fxRateSource})` : undefined}
              style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 500 }}
            >
              {formatMoney(expense.amount, expense.currency)}
            </span>
          )}
        </>
      )}
    </span>
  );
}
