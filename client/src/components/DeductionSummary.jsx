import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { formatMoney } from '../lib/money.js';
import { formatHours } from '../lib/deductionInput.js';

// Reports answers "what did I spend". With apportionment, the vehicle log and
// the home-office log, it can answer the question people actually have: what am
// I claiming this year, and where does it come from.
//
// Two of those three are not money, and this used to pretend otherwise.
//
// It multiplied kilometres by a cents-per-kilometre rate and hours by an hourly
// one, and there is nowhere to set either — the screen that did was already
// unreferenced before it was deleted. So both rows read "no rate set" in amber,
// a paragraph underneath told everybody to ask an administrator about something
// no administrator could do, and the total quietly left both out while calling
// itself "Total deductions".
//
// They are reported as what they are instead: kilometres and hours, counted.
// The rates differ across every country this is sold in and change every year,
// so the totals are ours to get right and the multiplying belongs to whoever
// prepares the return. Same decision as the panels on Expenses, for the same
// reason, and now the two pages say the same thing.
export default function DeductionSummary({ financialYear, expenseClaim }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!financialYear) return undefined;
    let cancelled = false;
    api
      .get(`/deductions/${encodeURIComponent(financialYear)}`)
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [financialYear]);

  if (!financialYear) return null;

  const km = data?.vehicle?.totalKm || 0;
  const trips = data?.vehicle?.trips?.length || 0;
  const hours = data?.homeOffice?.hours || 0;
  const days = data?.homeOffice?.entries?.length || 0;

  // Nothing beyond expenses to add up — the category table already says it all.
  if (km <= 0 && hours <= 0) return null;

  const rows = [
    {
      label: 'Expenses',
      detail: 'receipts, apportioned by business use',
      value: formatMoney(expenseClaim || 0),
      strong: true,
    },
    km > 0 && {
      label: 'Vehicle',
      detail: `${trips} ${trips === 1 ? 'trip' : 'trips'} logged`,
      value: `${km.toLocaleString()} km`,
    },
    hours > 0 && {
      label: 'Home office',
      detail: `${days} ${days === 1 ? 'day' : 'days'} logged`,
      value: formatHours(hours),
    },
  ].filter(Boolean);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
      {/* The link to kilometres and hours has gone. It pointed at All expenses,
          which is where somebody already is one click away, and the two rows
          below name the same thing more usefully than a link to it does. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Icon name="cash" size={18} style={{ color: 'var(--emerald)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>What you're claiming for FY {financialYear}</span>
      </div>

      <div style={{ padding: '6px 18px 14px' }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              padding: '10px 0',
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13.5, minWidth: 110 }}>{row.label}</span>
            <span style={{ flex: 1, minWidth: 140, fontSize: 12.5, color: 'var(--text-muted)' }}>{row.detail}</span>
            <span
              style={{
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: row.strong ? 'var(--emerald)' : undefined,
              }}
            >
              {row.value}
            </span>
          </div>
        ))}

        {/* No grand total across the three, because there is no honest one to
            give. Adding dollars to kilometres needs a rate, and the rate is the
            thing we do not have — a figure that silently left two of the three
            rows out was worse than not printing one. */}
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.55 }}>
          Kilometres and hours are counted, not costed. Apply your own tax office's rate for the year to those two
          totals — or hand them to your accountant, who will.
        </p>
      </div>
    </div>
  );
}
