import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { formatMoney } from '../lib/money.js';

// Reports answers "what did I spend". With apportionment, the vehicle log and
// the home-office log, it can answer the question people actually have: what am
// I claiming this year, and where does it come from.
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

  const vehicle = data?.vehicle?.amount ?? null;
  const office = data?.homeOffice?.amount ?? null;
  const hasOther = (data?.vehicle?.totalKm || 0) > 0 || (data?.homeOffice?.hours || 0) > 0;

  // Nothing beyond expenses to add up — the category table already says it all.
  if (!hasOther) return null;

  const total = (expenseClaim || 0) + (vehicle || 0) + (office || 0);
  const anyMissingRate = (data?.vehicle?.totalKm > 0 && vehicle === null) || (data?.homeOffice?.hours > 0 && office === null);

  const rows = [
    { label: 'Expenses', detail: 'receipts, apportioned by business use', amount: expenseClaim || 0 },
    (data?.vehicle?.totalKm || 0) > 0 && {
      label: 'Vehicle',
      detail: `${data.vehicle.totalKm} km${data.rates.centsPerKm ? ` at ${data.rates.centsPerKm}c` : ''}`,
      amount: vehicle,
    },
    (data?.homeOffice?.hours || 0) > 0 && {
      label: 'Home office',
      detail: `${data.homeOffice.hours} hours${data.rates.perHour ? ` at ${data.rates.perHour}` : ''}`,
      amount: office,
    },
  ].filter(Boolean);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="cash" size={18} style={{ color: 'var(--emerald)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>What you're claiming for FY {financialYear}</span>
        <Link to="/expenses" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 }}>
          Kilometres &amp; hours →
        </Link>
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
                color: row.amount === null ? 'var(--amber)' : undefined,
              }}
            >
              {row.amount === null ? 'no rate set' : formatMoney(row.amount)}
            </span>
          </div>
        ))}

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            padding: '12px 0 2px',
            borderTop: '2px solid var(--border)',
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>Total deductions</span>
          <span style={{ fontWeight: 800, fontSize: 17, color: 'var(--emerald)', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(total)}
          </span>
        </div>

        {anyMissingRate && (
          <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '10px 0 0', lineHeight: 1.5 }}>
            One of these has no rate set for FY {financialYear}, so it isn't in the total yet. Your entries are
            recorded either way — ask your administrator to set the rate.
          </p>
        )}
      </div>
    </div>
  );
}
