import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import { formatDayMonth } from '../lib/dates.js';
import { useFinancialYears } from '../lib/useFinancialYears.js';
import { currentFinancialYear } from '../lib/financialYear.js';
import { playSuccess, playError, onDigitKeyDown } from '../lib/sounds.js';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import HoursPicker from '../components/HoursPicker.jsx';
import { onCasedInput } from '../lib/casedInput.js';
import { sentenceCaseLive, titleCaseLive } from '../lib/textCase.js';
import {
  kmWhileTyping,
  parseKm,
  toDecimalHours,
  formatHours,
} from '../lib/deductionInput.js';

// The deductions that aren't receipts: kilometres driven for work and hours
// worked at home. Both are logged as they happen, because both are claimed at
// a rate that only holds up if the record was contemporaneous.

// What has been logged, not what it is worth.
//
// Both panels used to lead with a dollar figure worked out from a published
// rate. There is nowhere to set those rates, so every account saw "No rate set"
// and $0.00 for ever — a permanent warning about a thing nobody could do
// anything about, sitting where the most useful number should be.
//
// Rates also differ across every country this is sold in and change each year.
// Publishing them is a maintenance burden and, if one is ever wrong, somebody
// files a return on our arithmetic. The totals are the part that is ours to be
// right about: this many kilometres, these many hours, all of it exportable.
// Multiplying is the accountant's job, or the return's.
function Panel({ title, icon, summary, children }) {
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
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{summary}</span>
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

  // Two ways to say the same thing: the distance, or the two odometer
  // readings it came from. A logbook is kept in readings, and subtracting them
  // by hand is both a chore and the easiest place to make a mistake nobody
  // would ever catch.
  const [trip, setTrip] = useState({ date: '', vehicle: '', km: '', purpose: '', from: '', to: '' });

  // Typing a reading works out the distance and writes it into the total,
  // where it stays editable — derived, not locked. Readings that do not make a
  // distance yet leave the total alone rather than wiping a number somebody
  // typed by hand.
  function setReading(which, value) {
    const next = { ...trip, [which]: value };
    const from = parseKm(next.from);
    const to = parseKm(next.to);
    if (from !== null && to !== null && to > from) next.km = (to - from).toLocaleString();
    setTrip(next);
  }

  // Hours and minutes are chosen, not typed — see deductionInput.js for why.
  // The decimal the server wants is worked out on the way out.
  const [hours, setHours] = useState({ date: '', h: '', m: '', note: '' });

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
      // The separators are display only. What goes to the server is a number.
      // Only ever a distance on the wire. The readings are how somebody
      // arrived at it, not something the claim is made of.
      await api.post('/deductions/vehicle-trips', {
        date: trip.date,
        vehicle: trip.vehicle,
        purpose: trip.purpose,
        km: tripKm,
        entityId,
      });
      playSuccess();
      // The vehicle stays, because the next trip is usually the same car.
      setTrip({ date: '', vehicle: trip.vehicle, km: '', purpose: '', from: '', to: '' });
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
      await api.post('/deductions/home-office', {
        date: hours.date,
        hours: toDecimalHours(hours.h, hours.m),
        note: hours.note,
        entityId,
      });
      playSuccess();
      setHours({ date: '', h: '', m: '', note: '' });
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

  // What each form needs before it can be sent.
  //
  // Stated here rather than left to the browser, because required alone lets
  // somebody press a live button and be refused — and the two forms disagreed
  // about what counted anyway: purpose and note were never required, but the
  // button looked exactly as ready without them as with.
  //
  // A trip needs a date, something to call the vehicle, and a distance above
  // zero. Purpose stays optional — it is the description of a trip, not the
  // claim, and demanding one would have people typing "work" to get past it.
  // What is being claimed. Always the total field, whether it was typed or
  // worked out from the readings — one number submitted either way, so the
  // figure shown, the figure checked and the figure sent cannot differ.
  const odoFrom = parseKm(trip.from);
  const odoTo = parseKm(trip.to);
  const odoKm = odoFrom !== null && odoTo !== null ? odoTo - odoFrom : null;
  const tripKm = parseKm(trip.km);
  const fromReadings = odoKm !== null && odoKm > 0 && odoKm === tripKm;

  // Said rather than left to be discovered by a disabled button. Readings the
  // wrong way round is the ordinary mistake — the trip is still real, the two
  // numbers are just in the wrong boxes.
  const odoProblem =
    odoFrom === null || odoTo === null
      ? ''
      : odoTo < odoFrom
      ? 'The finishing reading is lower than the starting one.'
      : odoTo === odoFrom
      ? 'Both readings are the same, so there is no distance to claim.'
      : '';

  const tripReady =
    Boolean(trip.date) && trip.vehicle.trim().length > 0 && (tripKm || 0) > 0 && !odoProblem;

  // Hours needs a date and a time above zero. Either dropdown alone is enough
  // — 45 minutes with no hours is a perfectly ordinary entry — so it is the
  // total that has to be more than nothing.
  const hoursReady = Boolean(hours.date) && toDecimalHours(hours.h, hours.m) > 0;

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
            title="Vehicle — kilometres driven"
            icon="car"
            summary={
              vehicle.totalKm > 0
                ? `${vehicle.totalKm.toLocaleString()} km · ${vehicle.trips.length} trip${vehicle.trips.length === 1 ? '' : 's'}`
                : 'Nothing logged yet'
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
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}
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
                    onChange={onCasedInput(titleCaseLive, (value) => setTrip({ ...trip, vehicle: value }))}
                  />
                </div>
                {/* Start, finish, total — all three on the form at once.
                    Readings used to be behind a link, which meant a feature
                    nobody found. Type two readings and the total fills itself
                    in; or ignore them and type the total. */}
                <div style={{ flex: '1 1 108px', minWidth: 100 }}>
                  <label className="label">Odometer start</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="e.g. 41,200"
                    value={trip.from}
                    onChange={onCasedInput(kmWhileTyping, (value) => setReading('from', value))}
                  />
                </div>
                <div style={{ flex: '1 1 108px', minWidth: 100 }}>
                  <label className="label">Odometer finish</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="e.g. 41,538"
                    value={trip.to}
                    onChange={onCasedInput(kmWhileTyping, (value) => setReading('to', value))}
                  />
                </div>
                <div style={{ flex: '1 1 130px', minWidth: 120 }}>
                  <label className="label">Total kilometres</label>
                  <input
                    className="input"
                    required
                    inputMode="numeric"
                    placeholder="e.g. 338"
                    value={trip.km}
                    onChange={onCasedInput(kmWhileTyping, (value) => setTrip({ ...trip, km: value }))}
                    style={fromReadings ? { borderColor: 'var(--emerald)', fontWeight: 700 } : undefined}
                  />
                  {/* Where the number came from, or what is wrong with it.
                      The total stays typeable even once the readings have
                      filled it in — worked out, not locked. */}
                  <div style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
                    {odoProblem ? (
                      <span style={{ color: 'var(--red)' }}>{odoProblem}</span>
                    ) : fromReadings ? (
                      <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>From the readings</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Or type it in</span>
                    )}
                  </div>
                </div>
                <div style={{ flex: '2 1 200px', minWidth: 150 }}>
                  <label className="label">Purpose</label>
                  <input
                    className="input"
                    maxLength={255}
                    placeholder="e.g. Site visit, Parramatta"
                    value={trip.purpose}
                    onChange={onCasedInput(sentenceCaseLive, (value) => setTrip({ ...trip, purpose: value }))}
                  />
                </div>
                {/* Full width once it is on a line of its own, rather than a
                    small button marooned beside a gap. The empty label is a
                    spacer: without it the button sits level with the other
                    labels instead of level with the fields. */}
                <div style={{ flex: '1 1 auto', minWidth: 110 }}>
                  <span className="label" aria-hidden="true">
                    &nbsp;
                  </span>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy || !tripReady}
                    style={{ fontSize: 13, width: '100%', justifyContent: 'center' }}
                  >
                    Add trip
                  </button>
                </div>
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
            summary={
              office.hours > 0
                ? `${formatHours(office.hours)} · ${office.entries.length} day${office.entries.length === 1 ? '' : 's'}`
                : 'Nothing logged yet'
            }
          >
            {!readOnly && (
              <form
                onSubmit={addHours}
                className="deduction-form"
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}
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
                {/* Stepped and tapped, not chosen from a list.
                    "Half an hour" is 0.5 as a decimal and 0.30 on a clock, so
                    the field never asks for either — hours step, minutes are
                    four buttons, and the decimal is worked out. */}
                <div style={{ flex: '1 1 330px', minWidth: 320 }}>
                  <HoursPicker
                    hours={hours.h}
                    minutes={hours.m}
                    onChange={(h, m) => setHours({ ...hours, h: String(h), m: String(m) })}
                  />
                </div>
                <div style={{ flex: '2 1 200px', minWidth: 150 }}>
                  <label className="label">Note</label>
                  <input
                    className="input"
                    maxLength={255}
                    placeholder="Optional"
                    value={hours.note}
                    onChange={onCasedInput(sentenceCaseLive, (value) => setHours({ ...hours, note: value }))}
                  />
                </div>
                {/* The empty label is a spacer; see the trip form above. */}
                <div style={{ flex: '1 1 auto', minWidth: 110 }}>
                  <span className="label" aria-hidden="true">
                    &nbsp;
                  </span>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy || !hoursReady}
                    style={{ fontSize: 13, width: '100%', justifyContent: 'center' }}
                  >
                    Add hours
                  </button>
                </div>
              </form>
            )}

            <EntryList
              rows={office.entries}
              empty="No hours logged for this year yet."
              render={(h) => (
                <>
                  <span style={{ width: 62, color: 'var(--text-muted)' }}>{formatDayMonth(h.date)}</span>
                  <span style={{ fontWeight: 600, width: 80, whiteSpace: 'nowrap' }}>{formatHours(h.hours)}</span>
                  <span className="deduction-note" style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)' }}>
                    {h.note}
                  </span>
                </>
              )}
              onRemove={readOnly ? null : (id) => remove('home-office', id)}
            />
          </Panel>

          {/* What this page is for, said once at the foot.
              It used to apologise for a missing rate. There is no rate: the
              cents per kilometre and the hourly figure differ by country and
              change every year, so the totals are ours to get right and the
              multiplying belongs to whoever prepares the return. */}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
            Your logbook, kept as you go. Apply your own tax office’s rate for the year to these totals — or hand
            them to your accountant, who will.
          </p>
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
