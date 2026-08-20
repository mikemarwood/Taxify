import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { playSuccess, playError } from '../lib/sounds.js';
import { onCasedInput } from '../lib/casedInput.js';
import { sentenceCaseLive, titleCaseLive } from '../lib/textCase.js';
import { kmWhileTyping, parseKm, toDecimalHours, formatHours } from '../lib/deductionInput.js';
import { financialYearRange, financialYearOf } from '../lib/financialYear.js';
import { todayIso } from '../lib/dates.js';
import HoursPicker from './HoursPicker.jsx';

// The two things you can claim without a receipt, as forms that go anywhere.
//
// They used to live inside the Other deductions page, which meant somebody
// logging a day's work had to know that a trip is filed in one place and a
// receipt in another — a distinction that is about our database, not about
// their day. Add expense offers all three now, and this is what it offers.
//
// Each form owns its own state and its own submit. Sharing them upward through
// props would make every caller responsible for a shape it has no reason to
// know, and the two callers want the same behaviour anyway.

// What a date field will accept.
//
// Nothing in the future, because a logbook records what happened, and nothing
// outside the year being filed into, because the server files an entry by its
// date — an entry dated outside it would save and then not be in the list it
// was just added to.
function dateBounds(year, rule) {
  const range = financialYearRange(year, rule);
  const today = todayIso();
  return {
    min: range ? range.start : undefined,
    max: range && range.end < today ? range.end : today,
    // The picker enforces this, but a date can still be typed into it, so the
    // button reads the same bounds rather than trusting the widget.
    ok: (value) =>
      Boolean(value) && (!range || value >= range.start) && value <= (range && range.end < today ? range.end : today),
  };
}

// Which year this entry lands in, said before it is saved.
//
// A date can be any past date — last April is an ordinary thing to log in
// September — and the year it belongs to follows from the date rather than
// from anything else on the form. Somebody entering an old trip should see
// it going to the right place instead of finding out on the reports page.
function FiledInto({ date, rule }) {
  const year = date ? financialYearOf(date, rule) : null;
  return (
    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5, minHeight: 17 }}>
      {year ? `Filed into FY ${year}` : ''}
    </div>
  );
}

const ROW = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' };

// The submit button has no label of its own, so an empty one holds its place —
// without it the button sits level with the other labels instead of level with
// the fields, and a hard-coded offset would not survive a change of type size.
function Submit({ children, disabled }) {
  return (
    <div style={{ flex: '1 1 auto', minWidth: 110 }}>
      <span className="label" aria-hidden="true">
        &nbsp;
      </span>
      <button
        className="btn btn-primary"
        type="submit"
        disabled={disabled}
        style={{ fontSize: 13, width: '100%', justifyContent: 'center' }}
      >
        {children}
      </button>
    </div>
  );
}

export function TripForm({ entityId, year, onAdded }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // The two readings are the whole of the input. There is no kilometres field
  // in the state because there is none on the form: the distance is worked out
  // from these every time it is needed, so the figure shown, the figure
  // checked and the figure sent cannot differ.
  const [trip, setTrip] = useState({ date: '', vehicle: '', purpose: '', from: '', to: '' });

  const bounds = dateBounds(year, user?.financialYearRule);
  const odoFrom = parseKm(trip.from);
  const odoTo = parseKm(trip.to);
  const odoKm = odoFrom !== null && odoTo !== null ? odoTo - odoFrom : null;
  const tripKm = odoKm !== null && odoKm > 0 ? odoKm : null;

  // Said rather than left to be discovered by a disabled button. Readings the
  // wrong way round is the ordinary mistake — the trip is still real, the two
  // numbers are just in the wrong boxes.
  const problem =
    odoFrom === null || odoTo === null
      ? ''
      : odoTo < odoFrom
      ? 'The finishing reading is lower than the starting one.'
      : odoTo === odoFrom
      ? 'Both readings are the same, so there is no distance to claim.'
      : '';

  const ready = bounds.ok(trip.date) && trip.vehicle.trim().length > 0 && (tripKm || 0) > 0 && !problem;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      // Only ever a distance on the wire. The readings are how somebody
      // arrived at it, not something the claim is made of.
      const res = await api.post('/deductions/vehicle-trips', {
        date: trip.date,
        vehicle: trip.vehicle,
        purpose: trip.purpose,
        km: tripKm,
        entityId,
      });
      playSuccess();
      // The vehicle stays, because the next trip is usually the same car.
      setTrip({ date: '', vehicle: trip.vehicle, purpose: '', from: '', to: '' });
      // What was lodged, said in the words of the thing rather than as a
      // count. "2 logged" tells somebody how many times they pressed a
      // button, not what is now on their return.
      onAdded?.({
        id: res.data?.id,
        detail: `${tripKm.toLocaleString()} km in the ${trip.vehicle.trim()}${
          trip.purpose.trim() ? ` — ${trip.purpose.trim()}` : ''
        }.`,
        againLabel: 'Add another trip',
      });
    } catch (err) {
      playError();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="deduction-form" style={ROW}>
      <div style={{ flex: '1 1 165px', minWidth: 165 }}>
        <label className="label">Date</label>
        <input
          className="input"
          type="date"
          required
          min={bounds.min}
          max={bounds.max}
          value={trip.date}
          onChange={(e) => setTrip({ ...trip, date: e.target.value })}
        />
        <FiledInto date={trip.date} rule={user?.financialYearRule} />
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
      {/* Start, finish, total. Two questions and one answer: the readings are
          what somebody knows, the distance is what follows from them, and
          nothing on the form asks for the same thing twice. */}
      <div style={{ flex: '1 1 108px', minWidth: 100 }}>
        <label className="label">Odometer start</label>
        <input
          className="input"
          required
          inputMode="numeric"
          placeholder="e.g. 41,200"
          value={trip.from}
          onChange={onCasedInput(kmWhileTyping, (value) => setTrip({ ...trip, from: value }))}
        />
      </div>
      <div style={{ flex: '1 1 108px', minWidth: 100 }}>
        <label className="label">Odometer finish</label>
        <input
          className="input"
          required
          inputMode="numeric"
          placeholder="e.g. 41,538"
          value={trip.to}
          onChange={onCasedInput(kmWhileTyping, (value) => setTrip({ ...trip, to: value }))}
        />
      </div>
      <div style={{ flex: '1 1 130px', minWidth: 120 }}>
        <label className="label">Total kilometres</label>
        {/* An answer, not a question. Disabled because there is nothing to
            decide here: subtracting one reading from the other has exactly one
            right result, and a field that can be typed over is a field that can
            disagree with the readings sitting next to it. */}
        <input
          className="input"
          disabled
          readOnly
          aria-live="polite"
          placeholder="—"
          value={tripKm > 0 ? tripKm.toLocaleString() : ''}
          style={tripKm > 0 ? { fontWeight: 800, color: 'var(--emerald)', borderColor: 'var(--emerald)' } : undefined}
        />
        <div style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
          {problem ? (
            <span style={{ color: 'var(--red)' }}>{problem}</span>
          ) : tripKm > 0 ? (
            <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>From the readings</span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>Both readings, and this fills itself in.</span>
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
      <Submit disabled={busy || !ready}>Add trip</Submit>
    </form>
  );
}

export function HoursForm({ entityId, year, onAdded }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Hours and minutes are chosen, not typed — see deductionInput.js for why.
  // The decimal the server wants is worked out on the way out.
  const [hours, setHours] = useState({ date: '', h: '', m: '', note: '' });

  const bounds = dateBounds(year, user?.financialYearRule);
  // Either half alone is enough — 45 minutes with no hours is a perfectly
  // ordinary entry — so it is the total that has to be more than nothing.
  const ready = bounds.ok(hours.date) && toDecimalHours(hours.h, hours.m) > 0;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/deductions/home-office', {
        date: hours.date,
        hours: toDecimalHours(hours.h, hours.m),
        note: hours.note,
        entityId,
      });
      playSuccess();
      const logged = toDecimalHours(hours.h, hours.m);
      setHours({ date: '', h: '', m: '', note: '' });
      onAdded?.({
        id: res.data?.id,
        detail: `${formatHours(logged)} worked from home${
          hours.note.trim() ? ` — ${hours.note.trim()}` : ''
        }.`,
        againLabel: 'Add more hours',
      });
    } catch (err) {
      playError();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="deduction-form" style={ROW}>
      <div style={{ flex: '1 1 165px', minWidth: 165 }}>
        <label className="label">Date</label>
        <input
          className="input"
          type="date"
          required
          min={bounds.min}
          max={bounds.max}
          value={hours.date}
          onChange={(e) => setHours({ ...hours, date: e.target.value })}
        />
        <FiledInto date={hours.date} rule={user?.financialYearRule} />
      </div>
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
      <Submit disabled={busy || !ready}>Add hours</Submit>
    </form>
  );
}
