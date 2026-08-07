import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import { formatMoney } from '../lib/money.js';
import { formatDayMonth } from '../lib/dates.js';
import { useFinancialYears } from '../lib/useFinancialYears.js';
import { currentFinancialYear } from '../lib/financialYear.js';
import { playSuccess, playError, onDigitKeyDown } from '../lib/sounds.js';
import { useConfirm } from '../lib/ConfirmContext.jsx';

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
        {/* minWidth: 0 and wrapping, because the rate note is a 45-character
            string sat beside an 18px figure. Without both, the note reflowed
            into a ragged column against a baseline-aligned amount — most of
            what made this page look cluttered on a phone. */}
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
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
      {/* deduction-panel so the padding can come down on a phone — 18px each
          side is 36px of a 298px budget, and nothing else in the app trims card
          padding at that width. */}
      <div className="deduction-panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

export default function Deductions() {
  const confirm = useConfirm();
  const { user } = useAuth();
  const toast = useToast();
  const { years } = useFinancialYears();
  // Which books an entry lands in used to be whatever the sidebar happened to
  // be set to, with nothing on the page saying so. Named here instead, the
  // same way Add expense names it.
  const { entities, entity: selectedEntity, showSwitcher, isAll } = useEntities();
  const [entityId, setEntityId] = useState('');
  const [year, setYear] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const readOnly = !!user?.actingAsClient;

  const [trip, setTrip] = useState({ date: '', vehicle: '', km: '', purpose: '' });
  const [hours, setHours] = useState({ date: '', hours: '', note: '' });

  useEffect(() => {
    if (!year && years.length > 0) setYear(years.includes(currentFinancialYear()) ? currentFinancialYear() : years[0]);
  }, [years, year]);

  // Follows the sidebar until somebody changes it here, and falls back to the
  // first set of books when the combined view is open — where there is nothing
  // selected to follow.
  useEffect(() => {
    if (entityId && entities.some((e) => String(e.id) === String(entityId))) return;
    const next = selectedEntity?.id || entities[0]?.id;
    if (next) setEntityId(String(next));
  }, [entities, selectedEntity, entityId]);

  const filingInto = entities.find((e) => String(e.id) === String(entityId)) || selectedEntity || null;

  function load(forYear = year, forEntity = entityId) {
    if (!forYear) return;
    api
      .get(`/deductions/${encodeURIComponent(forYear)}${forEntity ? `?entityId=${encodeURIComponent(forEntity)}` : ''}`)
      .then((res) => setData(res.data))
      .catch(() => setData(null));
  }

  useEffect(() => {
    setData(null);
    load(year, entityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, entityId]);

  async function addTrip(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/deductions/vehicle-trips', { ...trip, entityId });
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
      await api.post('/deductions/home-office', { ...hours, entityId });
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
    if (!(await confirm({ tone: 'danger', title: 'Remove this entry?', confirmLabel: 'Remove' }))) return;
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
        {/* Both labelled. An unlabelled dropdown of years beside an unlabelled
            dropdown of names left it to guesswork which one an entry followed. */}
        {showSwitcher && (
          <div style={{ minWidth: 170 }}>
            <label className="label" htmlFor="deduction-books">
              Which books
            </label>
            <select
              id="deduction-books"
              className="input"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              style={{ padding: '9px 10px', fontSize: 13 }}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.kind === 'business' ? ' — business' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ minWidth: 150 }}>
          <label className="label" htmlFor="deduction-year">
            Financial year
          </label>
          <select
            id="deduction-year"
            className="input"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={{ padding: '9px 10px', fontSize: 13 }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                FY {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Said once above both panels rather than repeated on each form, so
          there is never a doubt about where an entry is going. */}
      {filingInto && showSwitcher && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            padding: '9px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-inset)',
            fontSize: 12.5,
            color: 'var(--text-muted)',
          }}
        >
          <Icon name={filingInto.kind === 'business' ? 'briefcase' : 'user'} size={14} />
          <span>
            Showing and adding to <strong style={{ color: 'var(--text)' }}>{filingInto.name}</strong>, FY {year}
          </span>
        </div>
      )}

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
              <form
                onSubmit={addTrip}
                className="deduction-form"
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
              >
                <div style={{ flex: '1 1 165px', minWidth: 165 }}>
                  <label className="label">Date</label>
                  <input
                    className="input"
                    type="date"
                    required
                    value={trip.date}
                    onChange={(e) => setTrip({ ...trip, date: e.target.value })}
                  />
                </div>
                <div style={{ flex: '1 1 150px', minWidth: 130 }}>
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
                <div style={{ flex: '1 1 100px', minWidth: 92 }}>
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
                <div style={{ flex: '2 1 200px', minWidth: 150 }}>
                  <label className="label">Purpose</label>
                  <input
                    className="input"
                    maxLength={255}
                    placeholder="e.g. Site visit, Parramatta"
                    value={trip.purpose}
                    onChange={(e) => setTrip({ ...trip, purpose: e.target.value })}
                  />
                </div>
                {/* Full width once it is on a line of its own, rather than a
                    small button marooned beside a gap. */}
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={busy}
                  style={{ fontSize: 13, flex: '1 1 auto', minWidth: 110, justifyContent: 'center' }}
                >
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
                  {/* Ellipsis rather than overflow, the same as an expense row —
                      a long vehicle name used to run into the kilometres. */}
                  <span
                    style={{
                      fontWeight: 600,
                      minWidth: 90,
                      maxWidth: 150,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.vehicle}
                  </span>
                  <span style={{ width: 70, whiteSpace: 'nowrap' }}>{t.km} km</span>
                  {/* flex-basis 100% under the media query below, so the purpose
                      gets a line of its own instead of the ~16px that was left
                      over once everything else had taken its width. */}
                  <span className="deduction-note" style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)' }}>
                    {t.purpose}
                  </span>
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
              <form
                onSubmit={addHours}
                className="deduction-form"
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
              >
                <div style={{ flex: '1 1 165px', minWidth: 165 }}>
                  <label className="label">Date</label>
                  <input
                    className="input"
                    type="date"
                    required
                    value={hours.date}
                    onChange={(e) => setHours({ ...hours, date: e.target.value })}
                  />
                </div>
                <div style={{ flex: '1 1 100px', minWidth: 92 }}>
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
                <div style={{ flex: '2 1 200px', minWidth: 150 }}>
                  <label className="label">Note</label>
                  <input
                    className="input"
                    maxLength={255}
                    placeholder="Optional"
                    value={hours.note}
                    onChange={(e) => setHours({ ...hours, note: e.target.value })}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={busy}
                  style={{ fontSize: 13, flex: '1 1 auto', minWidth: 110, justifyContent: 'center' }}
                >
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
                  <span style={{ fontWeight: 600, width: 80, whiteSpace: 'nowrap' }}>{h.hours} hrs</span>
                  <span className="deduction-note" style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)' }}>
                    {h.note}
                  </span>
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
            className="deduction-row"
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
                // Padded out to something a thumb can actually hit. It was a
                // 14px icon with no padding at all, which is a 14px target.
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 8,
                  margin: -8,
                  lineHeight: 0,
                  flexShrink: 0,
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
