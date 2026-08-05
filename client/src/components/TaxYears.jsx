import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import Icon from './Icon.jsx';
import { formatMoney } from '../lib/money.js';
import { playSuccess, playError } from '../lib/sounds.js';
import { formatDateShort, formatAppointmentTime } from '../lib/dates.js';
import { lodgementPeriodsFor } from '../lib/lodgementPeriods.js';
import { claimable } from '../lib/money.js';

function formatWhen(value) {
  if (!value) return null;
  return formatDateShort(value, null);
}

// Stored as a plain local datetime ("2026-09-14 14:30:00") so it means the time
// written on it wherever it's read. Parsed by hand because Date() treats that
// string as UTC in some browsers and local in others.
function parseLocal(value) {
  if (!value) return null;
  const [datePart, timePart = '00:00:00'] = String(value).replace('T', ' ').split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

function formatAppointment(value) {
  const at = parseLocal(value);
  if (!at) return '';
  return formatAppointmentTime(at);
}

// Counts down in the units that are actually useful at that distance: months
// out, "3 weeks" is what you want; on the day, minutes are.
function countdown(value) {
  const at = parseLocal(value);
  if (!at) return null;
  const ms = at.getTime() - Date.now();

  // An appointment that has been and gone stops being a countdown. Within the
  // hour it's still "now"; after that it's history, and saying "happening now"
  // about last April would be nonsense.
  if (ms <= 0) {
    return ms > -60 * 60 * 1000 ? { text: 'Happening now', soon: true, urgent: true } : { text: 'Appointment passed', past: true };
  }

  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 14) return { text: `${Math.floor(days / 7)} weeks away` };
  if (days >= 2) return { text: `${days} days, ${hours % 24}h away`, soon: days <= 7 };
  if (hours >= 1) return { text: `${hours}h ${minutes % 60}m away`, soon: true, urgent: hours < 24 };
  return { text: `${minutes} min away`, soon: true, urgent: true };
}

const EMPTY_APPOINTMENT = { date: '', time: '09:00', company: '', accountant: '' };

// The admin side of each financial year: when the return is being done and with
// whom, what came back, and whether the year is closed. Kept together because
// they are one story told in order.
// expenses are needed to work out what a single quarter claimed — the year
// totals the page already has cannot be divided into quarters after the fact.
export default function TaxYears({ years, spendByYear, expenses, onFinalisedChange }) {
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canReopen, setCanReopen] = useState(false);
  const [refundYear, setRefundYear] = useState(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [bookingYear, setBookingYear] = useState(null);
  const [booking, setBooking] = useState(EMPTY_APPOINTMENT);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  // A countdown that doesn't move isn't one. A minute is fine — nothing here
  // is measured in seconds.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  function load() {
    api
      .get('/tax-years')
      .then((res) => {
        setData(res.data.entities || []);
        setCanEdit(res.data.canEdit);
        setCanReopen(res.data.canReopen);
        // A year is only closed once every one of its lodgements is. A business
        // that has filed one quarter has not finished its year.
        onFinalisedChange?.(
          (res.data.years || []).filter((y) => y.finalisedAt).map((y) => y.financialYear)
        );
      })
      .catch(() => setData([]));
  }

  useEffect(load, []);

  // Years an accountant wasn't given aren't theirs to record against. Keyed on
  // having a client open rather than on the role, so an account holder who also
  // does someone's books sees the same restriction the server enforces. It was
  // display-only either way, but offering years the save will refuse is a
  // promise the app then breaks.
  const allowed = user?.activeClient?.financialYears ?? null;
  const listed = (allowed ? years.filter((y) => allowed.includes(y)) : years).slice().reverse();

  // One row per lodgement rather than per year. Books that lodge annually
  // produce exactly one row per year and look precisely as they always did;
  // books that lodge quarterly produce four.
  const rule = user?.financialYearRule;
  const namePeriods = (data || []).length > 1;

  const rows = [];
  for (const books of data || []) {
    const recorded = new Map();
    for (const y of books.years || []) {
      for (const period of y.periods || []) {
        recorded.set(`${y.financialYear}|${period.period}`, period);
      }
    }

    for (const financialYear of listed) {
      for (const period of lodgementPeriodsFor(financialYear, rule, books.cadence)) {
        const entry = recorded.get(`${financialYear}|${period.period}`) || null;
        rows.push({
          key: `${books.id}|${financialYear}|${period.period}`,
          entityId: books.id,
          entityName: books.name,
          financialYear,
          period: period.period,
          // "FY 2025-2026" for a whole year, "Jul – Sep 2025" for a quarter.
          label: period.period === 'FY' ? `FY ${financialYear}` : period.label,
          start: period.start,
          end: period.end,
          entry,
          finalised: !!entry?.finalisedAt,
          appointment: entry?.appointment || null,
          // The claim for this period, not the year — computed here from the
          // dates each period covers, which is the whole payoff for keeping the
          // period maths in a module both sides share.
          spent:
            period.period === 'FY'
              ? spendByYear?.get(financialYear) || 0
              : (expenses || [])
                  .filter((e) => {
                    const day = String(e.purchaseDate || '').slice(0, 10);
                    return (
                      day >= period.start &&
                      day <= period.end &&
                      (!e.entity || e.entity.id === books.id)
                    );
                  })
                  .reduce((sum, e) => sum + claimable(e), 0),
        });
      }
    }
  }

  const byKey = new Map(rows.map((r) => [r.key, r]));

  async function saveRefund(key) {
    const row = byKey.get(key);
    if (!row) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      toast('Enter the refund as a positive amount', 'error');
      return;
    }

    const alreadyFinalised = row.finalised;

    // Closing the year stops anyone editing what it contained, so it is asked
    // plainly beforehand rather than discovered afterwards.
    if (!alreadyFinalised) {
      const confirmed = window.confirm(
        `Record ${formatMoney(value)} as the refund for ${row.label}?\n\n` +
          'This finalises it. Its expenses and receipts become read-only, so nothing can change what was ' +
          'claimed after the return was assessed.\n\n' +
          (canReopen
            ? 'You can reopen the year from this page if you need to correct something.'
            : 'Only the account holder can reopen it afterwards.')
      );
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      await api.put(`/tax-years/${encodeURIComponent(row.financialYear)}/refund`, {
        amount: value,
        notes,
        period: row.period,
        entityId: row.entityId,
      });
      playSuccess();
      toast(alreadyFinalised ? `${row.label} refund updated` : `${row.label} finalised`, 'success');
      setRefundYear(null);
      load();
    } catch (err) {
      playError();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveAppointment(key) {
    const row = byKey.get(key);
    if (!row) return;
    setBusy(true);
    try {
      await api.put(`/tax-years/${encodeURIComponent(row.financialYear)}/appointment`, {
        ...booking,
        period: row.period,
        entityId: row.entityId,
      });
      playSuccess();
      toast('Appointment saved — we’ll remind you the day before', 'success');
      setBookingYear(null);
      load();
    } catch (err) {
      playError();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function clearAppointment(key) {
    const row = byKey.get(key);
    if (!row) return;
    if (!window.confirm(`Remove the ${row.label} tax appointment?`)) return;
    try {
      await api.delete(
        `/tax-years/${encodeURIComponent(row.financialYear)}/appointment?period=${row.period}&entityId=${row.entityId}`
      );
      toast('Appointment removed', 'info');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function reopen(key) {
    const row = byKey.get(key);
    if (!row) return;
    if (
      !window.confirm(`Reopen ${row.label}?\n\nIts expenses and receipts become editable again. The refund is kept.`)
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.post(`/tax-years/${encodeURIComponent(row.financialYear)}/reopen`, {
        period: row.period,
        entityId: row.entityId,
      });
      toast(`${row.label} reopened`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (data === null || rows.length === 0) return null;

  const totalRefunded = rows.reduce((sum, r) => sum + (r.entry?.amount || 0), 0);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="cash" size={18} style={{ color: 'var(--emerald)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>Tax year by year</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {totalRefunded > 0 ? `${formatMoney(totalRefunded)} refunded across all years` : 'Appointments and refunds'}
        </span>
        {user?.role === 'accountant' && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            You can record these for your client
          </span>
        )}
      </div>

      <div>
        {rows.map((row, i) => {
          // The row's own key stands in for what used to be the year, so every
          // comparison below still reads the same while the unit underneath it
          // is now a lodgement rather than a whole year.
          const year = row.key;
          const { entry, spent, finalised, appointment } = row;
          const left = appointment && !finalised ? countdown(appointment.at) : null;

          return (
            <div
              key={row.key}
              style={{
                padding: '13px 18px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
                background: finalised ? 'var(--bg-inset)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, minWidth: 92 }}>{row.label}</span>
                {namePeriods && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{row.entityName}</span>
                )}

                {finalised && (
                  <span
                    title={`Finalised ${formatWhen(entry.finalisedAt)} — these records are read-only`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: 999,
                      color: 'var(--emerald)',
                      background: 'rgba(16, 185, 129, 0.13)',
                    }}
                  >
                    <Icon name="lock" size={11} />
                    Finalised
                  </span>
                )}

                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatMoney(spent)} claimed</span>
                <span style={{ flex: 1 }} />

                {refundYear !== year && (
                  <>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: 15,
                        fontVariantNumeric: 'tabular-nums',
                        color: entry?.amount != null ? 'var(--emerald)' : 'var(--text-muted)',
                      }}
                    >
                      {entry?.amount != null ? formatMoney(entry.amount) : '—'}
                    </span>
                    {canEdit && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '6px 11px', gap: 6 }}
                        onClick={() => {
                          setRefundYear(year);
                          setBookingYear(null);
                          setAmount(entry?.amount != null ? String(entry.amount) : '');
                          setNotes(entry?.notes || '');
                        }}
                      >
                        <Icon name="pencil" size={13} />
                        {entry?.amount != null ? 'Edit refund' : 'Record refund'}
                      </button>
                    )}
                    {finalised && canReopen && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '6px 11px' }}
                        disabled={busy}
                        onClick={() => reopen(year)}
                      >
                        Reopen
                      </button>
                    )}
                  </>
                )}
              </div>

              {entry?.amount != null && refundYear !== year && (entry.recordedBy || entry.notes) && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5, paddingLeft: 104 }}>
                  {entry.recordedBy && `Recorded by ${entry.recordedBy}`}
                  {entry.recordedBy && entry.updatedAt && ` · ${formatWhen(entry.updatedAt)}`}
                  {entry.notes && ` · ${entry.notes}`}
                </div>
              )}

              {/* An appointment only makes sense while the year is still open —
                  once it's finalised, the return has been done. */}
              {!finalised && bookingYear !== year && (
                <div style={{ marginTop: 8, paddingLeft: 104 }}>
                  {appointment ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: 999,
                          color: left?.urgent ? '#1a1200' : 'var(--accent)',
                          background: left?.urgent ? 'var(--amber)' : 'var(--accent-soft)',
                          border: `1px solid ${left?.urgent ? 'transparent' : 'var(--accent-ring)'}`,
                        }}
                      >
                        <Icon name="briefcase" size={12} />
                        {formatAppointment(appointment.at)} · {appointment.company}
                        {appointment.accountant ? ` (${appointment.accountant})` : ''}
                      </span>
                      {left && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            color: left.urgent ? 'var(--amber)' : left.soon ? 'var(--accent)' : 'var(--text-muted)',
                          }}
                        >
                          {left.text}
                        </span>
                      )}
                      {canEdit && (
                        <>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11.5, padding: '4px 10px' }}
                            onClick={() => {
                              const at = parseLocal(appointment.at);
                              setBookingYear(year);
                              setRefundYear(null);
                              setBooking({
                                date: at ? at.toISOString().slice(0, 10) : '',
                                time: at
                                  ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
                                  : '09:00',
                                company: appointment.company || '',
                                accountant: appointment.accountant || '',
                              });
                            }}
                          >
                            Change
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11.5, padding: '4px 10px' }}
                            onClick={() => clearAppointment(year)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    canEdit && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11.5, padding: '5px 11px', gap: 6 }}
                        onClick={() => {
                          setBookingYear(year);
                          setRefundYear(null);
                          setBooking(EMPTY_APPOINTMENT);
                        }}
                      >
                        <Icon name="plus" size={12} />
                        Add tax appointment
                      </button>
                    )
                  )}
                </div>
              )}

              <AnimatePresence initial={false}>
                {refundYear === year && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', paddingTop: 12 }}>
                      <div style={{ width: 160 }}>
                        <label className="label">Refund received</label>
                        <input
                          className="input"
                          autoFocus
                          inputMode="decimal"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <label className="label">Note (optional)</label>
                        <input
                          className="input"
                          maxLength={500}
                          placeholder="e.g. Assessed 14 Oct, includes offset"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </div>
                      <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy} onClick={() => saveRefund(year)}>
                        {busy && <span className="spinner" />}
                        {finalised ? 'Save' : 'Record & finalise'}
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setRefundYear(null)}>
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}

                {bookingYear === year && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', paddingTop: 12 }}>
                      <div style={{ width: 150 }}>
                        <label className="label">Date</label>
                        <input
                          className="input"
                          type="date"
                          autoFocus
                          value={booking.date}
                          onChange={(e) => setBooking((b) => ({ ...b, date: e.target.value }))}
                        />
                      </div>
                      <div style={{ width: 110 }}>
                        <label className="label">Time</label>
                        <input
                          className="input"
                          type="time"
                          value={booking.time}
                          onChange={(e) => setBooking((b) => ({ ...b, time: e.target.value }))}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Company</label>
                        <input
                          className="input"
                          maxLength={160}
                          placeholder="e.g. H&R Block Parramatta"
                          value={booking.company}
                          onChange={(e) => setBooking((b) => ({ ...b, company: e.target.value }))}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Accountant (optional)</label>
                        <input
                          className="input"
                          maxLength={160}
                          placeholder="Who you're seeing"
                          value={booking.accountant}
                          onChange={(e) => setBooking((b) => ({ ...b, accountant: e.target.value }))}
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 13 }}
                        disabled={busy || !booking.date || !booking.time || !booking.company.trim()}
                        onClick={() => saveAppointment(year)}
                      >
                        {busy && <span className="spinner" />}
                        Save appointment
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setBookingYear(null)}>
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
