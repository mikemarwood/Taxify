import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import { onCasedInput } from '../lib/casedInput.js';
import { sentenceCaseLive, titleCaseLive } from '../lib/textCase.js';
import { kmWhileTyping, parseKm } from '../lib/deductionInput.js';
import { todayIso } from '../lib/dates.js';

// Correcting a trip that is already logged.
//
// It could only be deleted and retyped before, which is the wrong shape for
// the mistakes people actually make: a digit wrong in an odometer reading, or
// a destination left blank. Retyping five fields to fix one invites a second
// mistake in a field that was already right — and deleting first means a
// moment where the claim does not exist at all.
//
// Deliberately the same rules as adding one. The distance is derived from the
// readings and cannot be typed over, because a start and an end that do not
// subtract to the number being claimed are two different stories and nobody
// could say afterwards which was true. Both are optional together: a trip
// logged before the readings existed has neither, and reopening it should not
// suddenly demand them.
export default function EditTripModal({ trip, onClose, onSaved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // What the form opened on, so it can tell whether anything has moved.
  const initial = {
    date: String(trip.date).slice(0, 10),
    vehicle: trip.vehicle || '',
    startPlace: trip.startPlace || '',
    endPlace: trip.endPlace || '',
    purpose: trip.purpose || '',
    from: trip.odoStart === null ? '' : Number(trip.odoStart).toLocaleString(),
    to: trip.odoEnd === null ? '' : Number(trip.odoEnd).toLocaleString(),
  };

  const [date, setDate] = useState(String(trip.date).slice(0, 10));
  const [vehicle, setVehicle] = useState(trip.vehicle || '');
  const [startPlace, setStartPlace] = useState(trip.startPlace || '');
  const [endPlace, setEndPlace] = useState(trip.endPlace || '');
  const [purpose, setPurpose] = useState(trip.purpose || '');
  const [from, setFrom] = useState(trip.odoStart === null ? '' : Number(trip.odoStart).toLocaleString());
  const [to, setTo] = useState(trip.odoEnd === null ? '' : Number(trip.odoEnd).toLocaleString());

  const odoStart = parseKm(from);
  const odoEnd = parseKm(to);
  const bothGiven = from.trim() !== '' && to.trim() !== '';
  const derived = bothGiven && odoStart !== null && odoEnd !== null ? odoEnd - odoStart : null;

  // Keeps whatever distance the trip already had when the readings are left
  // blank, so an old trip can have its destination filled in without losing
  // the only number on it.
  const km = bothGiven ? derived : Number(trip.km);

  const problem =
    bothGiven && derived !== null && derived <= 0
      ? 'The finish reading has to be higher than the start'
      : bothGiven && (odoStart === null || odoEnd === null)
        ? 'Both readings have to be numbers'
        : null;

  // Compared on the parsed readings rather than the typed text, so retyping
  // "41200" as "41,200" is not a change — it is the same number written
  // differently, and offering to save it would be offering to save nothing.
  const dirty =
    date !== initial.date ||
    vehicle !== initial.vehicle ||
    startPlace !== initial.startPlace ||
    endPlace !== initial.endPlace ||
    purpose !== initial.purpose ||
    parseKm(from) !== parseKm(initial.from) ||
    parseKm(to) !== parseKm(initial.to);

  const ready = Boolean(date) && Boolean(vehicle.trim()) && !problem && Number(km) > 0 && dirty;

  async function save(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await api.patch(`/deductions/vehicle-trips/${trip.id}`, {
        date,
        vehicle,
        km,
        purpose,
        startPlace,
        endPlace,
        // Sent only as a pair. The server keeps them only when they agree with
        // the distance, so half a pair would be silently dropped anyway.
        odoStart: bothGiven ? odoStart : undefined,
        odoEnd: bothGiven ? odoEnd : undefined,
      });
      toast('Trip updated', 'success');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit trip"
      // No close on the backdrop.
      //
      // This is a form somebody is part-way through typing into, and a stray
      // click beside it threw the lot away with no warning and no undo. The
      // cross and Cancel are both deliberate; a click on the surround is not.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2400,
        background: 'rgba(6, 10, 18, .6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <motion.form
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onSubmit={save}
        className="card"
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '90dvh',
          overflowY: 'auto',
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Edit trip</h2>
          <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            The distance follows the readings, so it cannot disagree with them.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <label className="label">Date</label>
            <input
              className="input"
              type="date"
              required
              max={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <label className="label">Vehicle</label>
            <input
              className="input"
              required
              maxLength={80}
              value={vehicle}
              onChange={onCasedInput(titleCaseLive, setVehicle)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <label className="label">Start</label>
            <input
              className="input"
              maxLength={120}
              placeholder="e.g. Home"
              value={startPlace}
              onChange={onCasedInput(titleCaseLive, setStartPlace)}
            />
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <label className="label">Destination</label>
            <input
              className="input"
              maxLength={120}
              placeholder="e.g. Bunnings Joondalup"
              value={endPlace}
              onChange={onCasedInput(titleCaseLive, setEndPlace)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <label className="label">Odometer start</label>
            <input
              className="input"
              inputMode="numeric"
              placeholder="e.g. 41,200"
              value={from}
              onChange={onCasedInput(kmWhileTyping, setFrom)}
            />
          </div>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <label className="label">Odometer finish</label>
            <input
              className="input"
              inputMode="numeric"
              placeholder="e.g. 41,538"
              value={to}
              onChange={onCasedInput(kmWhileTyping, setTo)}
            />
          </div>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <label className="label">Total kilometres</label>
            <input
              className="input"
              disabled
              readOnly
              value={Number(km) > 0 ? Number(km).toLocaleString() : ''}
              style={Number(km) > 0 ? { fontWeight: 800, color: 'var(--emerald)' } : undefined}
            />
          </div>
        </div>

        {problem && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{problem}</div>}
        {!bothGiven && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            This trip has no odometer readings, so its distance of {Number(trip.km).toLocaleString()} km is kept as it
            is. Fill both in to have it worked out from them.
          </div>
        )}

        <div>
          <label className="label">Purpose</label>
          <input
            className="input"
            maxLength={255}
            placeholder="e.g. Picking up materials"
            value={purpose}
            onChange={onCasedInput(sentenceCaseLive, setPurpose)}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!ready || busy}>
            {busy && <span className="spinner" />}
            Save trip
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {dirty ? 'Discard changes' : 'Close'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
