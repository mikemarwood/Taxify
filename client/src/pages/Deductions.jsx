import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import { formatMoney } from '../lib/money.js';
import { formatDayMonth } from '../lib/dates.js';
import { useFinancialYears } from '../lib/useFinancialYears.js';
import { currentFinancialYear } from '../lib/financialYear.js';
import { playSuccess, playError, onDigitKeyDown } from '../lib/sounds.js';

// The deductions that aren't receipts: kilometres driven for work and hours
// worked at home. Both are logged as they happen, because both are claimed at
// a rate that only holds up if the record was contemporaneous.

function Panel({ title, icon, claim, rateNote, children }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <Icon name={icon} size={18} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {claim === null ? (
            <span style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 600 }}>{rateNote}</span>
          ) : (
            <>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--emerald)' }}>{formatMoney(claim)}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{rateNote}</span>
            </>
          )}
        </span>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </div>
  );
}

export default function Deductions() {
  const { user } = useAuth();
  const toast = useToast();
  const { years } = useFinancialYears();
  const [year, setYear] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const readOnly = !!user?.actingAsClient;

  const [trip, setTrip] = useState({ date: '', vehicle: '', km: '', purpose: '' });
  const [hours, setHours] = useState({ date: '', hours: '', note: '' });

  useEffect(() => {
    if (!year && years.length > 0) setYear(years.includes(currentFinancialYear()) ? currentFinancialYear() : years[0]);
  }, [years, year]);

  function load(forYear = year) {
    if (!forYear) return;
    api
      .get(`/deductions/${encodeURIComponent(forYear)}`)
      .then((res) => setData(res.data))
      .catch(() => setData(null));
  }

  useEffect(() => {
    setData(null);
    load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function addTrip(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/deductions/vehicle-trips', trip);
      playSuccess();
      setTrip({ date: '', vehicle: trip.vehicle, km: '', purpose: '' });
      load();
    } catch (err) {
      playError();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addHours(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/deductions/home-office', hours);
      playSuccess();
      setHours({ date: '', hours: '', note: '' });
      load();
    } catch (err) {
      playError();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind, id) {
    if (!window.confirm('Remove this entry?')) return;
    try {
      await api.delete(`/deductions/${kind}/${id}`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const vehicle = data?.vehicle;
  const office = data?.homeOffice;

  return (
    <div style={{ maxWidth: 940 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Other deductions</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            Kilometres and hours — the claims that don't come with a receipt.
          </p>
        </div>
        <select
          className="input"
          aria-label="Financial year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{ width: 150, padding: '9px 10px', fontSize: 13 }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
      </div>

      {!data ? (
        <SkeletonList rows={4} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel
            title="Vehicle — cents per kilometre"
            icon="car"
            claim={vehicle.amount}
            rateNote={
              data.rates.centsPerKm === null
                ? `No rate set for FY ${year}`
                : `${vehicle.totalKm} km · ${data.rates.centsPerKm}c/km${
                    data.rates.kmCap ? ` · capped at ${data.rates.kmCap} km per car` : ''
                  }`
            }
          >
            {vehicle.vehicles.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {vehicle.vehicles.map((v) => (
                  <span
                    key={v.vehicle}
                    title={v.cappedBy ? `${v.cappedBy} km above the cap are not claimable` : undefined}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '5px 11px',
                      borderRadius: 999,
                      background: 'var(--bg-inset)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {v.vehicle}: {v.claimableKm} km
                    {v.cappedBy > 0 && (
                      <span style={{ color: 'var(--amber)', fontWeight: 500 }}> (+{v.cappedBy} over cap)</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {!readOnly && (
              <form onSubmit={addTrip} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ width: 148 }}>
                  <label className="label">Date</label>
                  <input
                    className="input"
                    type="date"
                    required
                    value={trip.date}
                    onChange={(e) => setTrip({ ...trip, date: e.target.value })}
                  />
                </div>
                <div style={{ width: 150 }}>
                  <label className="label">Vehicle</label>
                  <input
                    className="input"
                    required
                    maxLength={80}
                    placeholder="e.g. Hilux"
                    value={trip.vehicle}
                    onChange={(e) => setTrip({ ...trip, vehicle: e.target.value })}
                  />
                </div>
                <div style={{ width: 100 }}>
                  <label className="label">Kilometres</label>
                  <input
                    className="input"
                    required
                    inputMode="decimal"
                    value={trip.km}
                    onKeyDown={onDigitKeyDown}
                    onChange={(e) => setTrip({ ...trip, km: e.target.value.replace(/[^0-9.]/g, '') })}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Purpose</label>
                  <input
                    className="input"
                    maxLength={255}
                    placeholder="e.g. Site visit, Parramatta"
                    value={trip.purpose}
                    onChange={(e) => setTrip({ ...trip, purpose: e.target.value })}
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy} style={{ fontSize: 13 }}>
                  Add trip
                </button>
              </form>
            )}

            <EntryList
              rows={vehicle.trips}
              empty="No trips logged for this year yet."
              render={(t) => (
                <>
                  <span style={{ width: 62, color: 'var(--text-muted)' }}>{formatDayMonth(t.date)}</span>
                  <span style={{ fontWeight: 600, width: 110 }}>{t.vehicle}</span>
                  <span style={{ width: 80 }}>{t.km} km</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)' }}>{t.purpose}</span>
                </>
              )}
              onRemove={readOnly ? null : (id) => remove('vehicle-trips', id)}
            />
          </Panel>

          <Panel
            title="Home office — hours worked"
            icon="home"
            claim={office.amount}
            rateNote={
              data.rates.perHour === null
                ? `No rate set for FY ${year}`
                : `${office.hours} hours · ${data.rates.perHour}/hour`
            }
          >
            {!readOnly && (
              <form onSubmit={addHours} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ width: 148 }}>
                  <label className="label">Date</label>
                  <input
                    className="input"
                    type="date"
                    required
                    value={hours.date}
                    onChange={(e) => setHours({ ...hours, date: e.target.value })}
                  />
                </div>
                <div style={{ width: 100 }}>
                  <label className="label">Hours</label>
                  <input
                    className="input"
                    required
                    inputMode="decimal"
                    value={hours.hours}
                    onKeyDown={onDigitKeyDown}
                    onChange={(e) => setHours({ ...hours, hours: e.target.value.replace(/[^0-9.]/g, '') })}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label className="label">Note</label>
                  <input
                    className="input"
                    maxLength={255}
                    placeholder="Optional"
                    value={hours.note}
                    onChange={(e) => setHours({ ...hours, note: e.target.value })}
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy} style={{ fontSize: 13 }}>
                  Add hours
                </button>
              </form>
            )}

            <EntryList
              rows={office.entries}
              empty="No hours logged for this year yet."
              render={(h) => (
                <>
                  <span style={{ width: 62, color: 'var(--text-muted)' }}>{formatDayMonth(h.date)}</span>
                  <span style={{ fontWeight: 600, width: 80 }}>{h.hours} hrs</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)' }}>{h.note}</span>
                </>
              )}
              onRemove={readOnly ? null : (id) => remove('home-office', id)}
            />
          </Panel>

          {(data.rates.centsPerKm === null || data.rates.perHour === null) && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
              A claim can only be worked out once the rate for that year is set. Your entries are being recorded either
              way — nothing is lost while the rate is missing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EntryList({ rows, render, onRemove, empty }) {
  if (!rows.length) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{empty}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <AnimatePresence initial={false}>
        {rows.map((row, i) => (
          <motion.div
            key={row.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: 12 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              padding: '8px 0',
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              flexWrap: 'wrap',
            }}
          >
            {render(row)}
            {onRemove && (
              <button
                type="button"
                title="Remove"
                onClick={() => onRemove(row.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
              >
                <Icon name="trash" size={14} />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
