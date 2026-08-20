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
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { TripForm, HoursForm } from '../components/DeductionForms.jsx';
import { formatHours } from '../lib/deductionInput.js';

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

  const readOnly = !!user?.actingAsClient;

  useEffect(() => {
    // The rule matters here: without it this asks for the Australian year and
    // never matches a British one, so those accounts always opened on their
    // oldest year instead of this one.
    if (!year && years.length > 0) {
      const now = currentFinancialYear(user?.financialYearRule);
      setYear(years.includes(now) ? now : years[0]);
    }
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

            {!readOnly && <TripForm entityId={entityId} year={year} onAdded={load} />}

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
            {!readOnly && <HoursForm entityId={entityId} year={year} onAdded={load} />}

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
