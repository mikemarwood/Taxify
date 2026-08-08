import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import { SkeletonList } from './Skeletons.jsx';
import { currentFinancialYear } from '../lib/financialYear.js';

// The rates behind the kilometre and home-office claims. They change every
// year, so they are data rather than code — a rate compiled into the app goes
// stale quietly and then mis-claims for every user at once.
const RATES = [
  {
    key: 'vehicle_cents_per_km',
    label: 'Vehicle — cents per kilometre',
    hint: 'Cents, e.g. 88 for 88c/km',
    suffix: 'c/km',
  },
  {
    key: 'vehicle_km_cap',
    label: 'Vehicle — kilometre cap',
    hint: 'Per car, per year, e.g. 5000',
    suffix: 'km',
  },
  {
    key: 'home_office_per_hour',
    label: 'Home office — rate per hour',
    hint: 'In dollars, e.g. 0.70 for 70c/hour',
    suffix: '/hour',
  },
];

function yearOptions() {
  const current = Number(currentFinancialYear().slice(0, 4));
  const list = [];
  for (let start = current + 1; start >= current - 5; start -= 1) list.push(`${start}-${start + 1}`);
  return list;
}

export default function TaxRatesTab() {
  const toast = useToast();
  const [rates, setRates] = useState(null);
  const [year, setYear] = useState(currentFinancialYear());
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/admin/tax-rates').then((res) => setRates(res.data.rates));
  }
  useEffect(load, []);

  const forYear = (key) => rates?.find((r) => r.financialYear === year && r.key === key);

  async function save(key) {
    const value = draft[key];
    if (value === undefined || value === '') return;
    setBusy(true);
    try {
      await api.put('/admin/tax-rates', { financialYear: year, key, value: Number(value) });
      toast('Rate saved', 'success');
      setDraft((d) => ({ ...d, [key]: undefined }));
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const missing = RATES.filter((r) => !forYear(r.key)).length;

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -12, marginBottom: 20, lineHeight: 1.6 }}>
        The rates behind the kilometre and home-office claims, set per financial year. A year with no rate claims
        nothing and says so, rather than falling back to last year's figure and quietly under- or over-claiming.
      </p>

      {/* Stated plainly, because getting these wrong is not a display bug —
          it is every user's return being wrong by the same margin. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '12px 14px',
          marginBottom: 20,
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(245, 158, 11, 0.10)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          fontSize: 12.5,
          lineHeight: 1.55,
        }}
      >
        <Icon name="alert" size={16} style={{ color: 'var(--amber)', marginTop: 1, flexShrink: 0 }} />
        <span>
          <strong>Check these against your revenue authority's current guidance before entering them.</strong>{' '}
          Taxify is used from several countries and the rates differ in every one, so nothing here is seeded with a
          default — a wrong rate produces a wrong claim that looks exactly like a right one.
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <label className="label" style={{ margin: 0 }}>
          Financial year
        </label>
        <select
          className="input"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{ width: 150, padding: '8px 10px', fontSize: 13 }}
        >
          {yearOptions().map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
        {missing > 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 600 }}>
            {missing} of {RATES.length} not set for this year
          </span>
        )}
      </div>

      {rates === null ? (
        <SkeletonList rows={3} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {RATES.map((rate) => {
            const existing = forYear(rate.key);
            const value = draft[rate.key] !== undefined ? draft[rate.key] : existing ? String(existing.value) : '';
            const changed = draft[rate.key] !== undefined && draft[rate.key] !== String(existing?.value ?? '');

            return (
              <div
                key={rate.key}
                className="card"
                style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}
              >
                <div style={{ flex: 1, minWidth: 210 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{rate.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{rate.hint}</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="Not set"
                    value={value}
                    onChange={(e) => setDraft({ ...draft, [rate.key]: e.target.value.replace(/[^0-9.]/g, '') })}
                    style={{ width: 110, textAlign: 'right' }}
                  />
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)', width: 46 }}>{rate.suffix}</span>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 12.5, padding: '8px 14px' }}
                    disabled={busy || !changed}
                    onClick={() => save(rate.key)}
                  >
                    Save
                  </button>
                </div>

                {!existing && (
                  <span style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--amber)' }}>
                    Not set for FY {year} — this claim shows as “no rate set” to users.
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
