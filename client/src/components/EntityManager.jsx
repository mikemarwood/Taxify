import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import { titleCase } from '../lib/textCase.js';
import Icon from './Icon.jsx';
import { playClick } from '../lib/sounds.js';

// Creating and organising sets of books, on the page where categories live —
// because a category belongs to one set of books, so "which business" has to be
// answered before "which category" makes any sense.

const KINDS = [
  { value: 'individual', label: 'Individual', hint: 'Your own tax return' },
  { value: 'business', label: 'Small business', hint: 'A business you run' },
];

const CADENCES = [
  { value: 'annual', label: 'Once a year' },
  { value: 'quarterly', label: 'Every quarter' },
];

// Compared the way the server compares them — trimmed, collapsed and
// case-insensitively — so "Acme  Plumbing" and "acme plumbing" are recognised
// as the same books before the request goes rather than coming back a 409.
function sameName(a, b) {
  return String(a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() ===
    String(b ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// `ignore` is the name being edited, so renaming a set of books to what it is
// already called is not reported as clashing with itself.
function nameTaken(value, all, ignore = null) {
  if (!String(value ?? '').trim()) return false;
  if (ignore && sameName(value, ignore)) return false;
  return all.some((e) => sameName(e.name, value));
}

export default function EntityManager() {
  const toast = useToast();
  const { entities, archived, allowance, selected, selectedId, choose, reload } = useEntities();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [kind, setKind] = useState('business');
  const [cadence, setCadence] = useState('quarterly');

  // Archived books count against the plan, which is why this comes from the
  // server rather than from the visible list.
  const atLimit = !!allowance && allowance.businessesLeft <= 0;

  // Archived books are included: the name is still taken, the server still
  // refuses it, and restoring one is a single press away.
  const allNames = [...entities, ...(archived || [])];
  const createClash = nameTaken(name, allNames);

  function resetForm() {
    setName('');
    setKind('business');
    setCadence('quarterly');
    setAdding(false);
  }

  // A business usually reports quarterly and an individual once a year, so the
  // cadence follows the kind until somebody says otherwise.
  function pickKind(next) {
    setKind(next);
    setCadence(next === 'business' ? 'quarterly' : 'annual');
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/entities', { name, kind, cadence });
      await reload();
      choose(data.entity.id);
      resetForm();
      toast(`${data.entity.name} created`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function save(entity, changes) {
    setBusy(true);
    try {
      await api.patch(`/entities/${entity.id}`, changes);
      await reload();
      setEditing(null);
      toast('Saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function archive(entity) {
    if (!window.confirm(`Archive ${entity.name}? Everything in it is kept — it just stops appearing.`)) return;
    try {
      await api.post(`/entities/${entity.id}/archive`, { archived: true });
      await reload();
      if (String(selected) === String(entity.id)) choose(null);
      toast(`${entity.name} archived`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function restore(entity) {
    try {
      await api.post(`/entities/${entity.id}/archive`, { archived: false });
      toast(`${entity.name} restored`, 'success');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(entity) {
    if (!window.confirm(`Delete ${entity.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/entities/${entity.id}`);
      await reload();
      if (String(selected) === String(entity.id)) choose(null);
      toast(`${entity.name} deleted`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {entities.map((e) => {
          const active = String(selected) === String(e.id);
          return (
            <div
              key={e.id}
              className="card"
              style={{
                padding: 12,
                minWidth: 210,
                flex: '1 1 210px',
                borderLeft: `4px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-soft)' : undefined,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  playClick();
                  choose(e.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text)',
                }}
              >
                <Icon name={e.kind === 'business' ? 'briefcase' : 'user'} size={16} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.name}
                </span>
                {e.isDefault && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', letterSpacing: 0.4 }}>
                    DEFAULT
                  </span>
                )}
              </button>

              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                {e.kind === 'business' ? 'Small business' : 'Individual'} ·{' '}
                {e.cadence === 'quarterly' ? 'lodges quarterly' : 'lodges yearly'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                {e.counts?.expenses ?? 0} expense{e.counts?.expenses === 1 ? '' : 's'} ·{' '}
                {e.counts?.categories ?? 0} categor{e.counts?.categories === 1 ? 'y' : 'ies'}
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 8px', marginTop: 8 }}
                onClick={() => setEditing(editing?.id === e.id ? null : e)}
              >
                {editing?.id === e.id ? 'Close' : 'Edit'}
              </button>

              <AnimatePresence>
                {editing?.id === e.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <EditRow
                      entity={e}
                      busy={busy}
                      canBecomeBusiness={atLimit ? e.kind === 'business' : true}
                      siblings={allNames}
                      onSave={save}
                      onArchive={archive}
                      onDelete={remove}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {atLimit ? (
          // Rendered as a real disabled button rather than a note, so it reads
          // as the control it replaces — greyed out and plainly unavailable,
          // instead of an explanation sitting where a button used to be.
          <button
            type="button"
            className="card"
            disabled
            aria-disabled="true"
            title={
              allowance?.businesses === 0
                ? 'Adding a business needs the Small Business plan'
                : `Your plan covers ${allowance?.businesses} businesses`
            }
            style={{
              padding: 12,
              minWidth: 190,
              flex: '1 1 190px',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              border: '1px dashed var(--border-strong)',
              background: 'var(--bg-inset)',
              fontSize: 12.5,
              font: 'inherit',
              textAlign: 'left',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
              opacity: 0.65,
              cursor: 'not-allowed',
            }}
          >
            <Icon name="lock" size={15} style={{ flexShrink: 0 }} />
            <span>
              <strong style={{ display: 'block', fontSize: 12.5 }}>Not available on this plan</strong>
              {allowance?.businesses === 0
                ? 'Small Business adds up to two businesses alongside your own tax.'
                : `You have all ${allowance?.businesses} businesses your plan covers.`}
            </span>
          </button>
        ) : (
        <button
          type="button"
          className="card"
          onClick={() => setAdding((v) => !v)}
          style={{
            padding: 12,
            minWidth: 150,
            flex: '0 1 150px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            border: '1px dashed var(--border-strong)',
            color: 'var(--text-muted)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Icon name={adding ? 'x' : 'plus'} size={15} />
          {adding ? 'Cancel' : 'New business'}
        </button>
        )}
      </div>

      <AnimatePresence>
        {adding && !atLimit && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={create}
            className="card"
            style={{ overflow: 'hidden', marginTop: 12, padding: 16, display: 'grid', gap: 14 }}
          >
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                required
                maxLength={60}
                value={name}
                onChange={(ev) => setName(titleCase(ev.target.value))}
                placeholder="e.g. Marwood Plumbing"
                aria-invalid={createClash ? 'true' : undefined}
                style={createClash ? { borderColor: 'var(--red)' } : undefined}
              />
              <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 5, color: createClash ? 'var(--red)' : 'var(--text-muted)' }}>
                {createClash ? 'You already have a set of books with that name' : ''}
              </div>
            </div>

            <div>
              <label className="label">What is it</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => pickKind(k.value)}
                    className={kind === k.value ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ fontSize: 12.5, padding: '7px 12px' }}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {kind === 'business'
                  ? 'Expenses here can be claimed at part business use.'
                  : 'Expenses here are always claimed in full — no percentage to fill in.'}
              </div>
            </div>

            <div>
              <label className="label">Lodges</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {CADENCES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCadence(c.value)}
                    className={cadence === c.value ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ fontSize: 12.5, padding: '7px 12px' }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Quarters run from the start of your financial year, so they match what you actually report.
              </div>
            </div>

            <button className="btn btn-primary" disabled={busy || !name.trim() || createClash} style={{ justifySelf: 'start' }}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Shown because they still count against the plan. Without this,
          archiving a business and then being refused another reads as the app
          contradicting itself — "you have all 2" with one on the screen and no
          way to find the other. */}
      {archived?.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Archived</h2>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Still counted by your plan, because unarchiving is one press.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {archived.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '10px 13px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-inset)',
                  border: '1px dashed var(--border-strong)',
                  fontSize: 13,
                }}
              >
                <Icon
                  name={e.kind === 'business' ? 'briefcase' : 'user'}
                  size={15}
                  style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                />
                <span style={{ flex: 1, minWidth: 120, fontWeight: 600 }}>{e.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {e.kind === 'business' ? 'Small business' : 'Individual'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '5px 11px' }}
                  onClick={() => restore(e)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EditRow({ entity, busy, canBecomeBusiness, siblings = [], onSave, onArchive, onDelete }) {
  const [name, setName] = useState(entity.name);
  // Held here until Save. Pressing "Every quarter" used to change how the
  // books lodge the instant it was pressed, with nothing to confirm and
  // nothing to undo — a decision that belongs to the same Save as the name.
  const [cadence, setCadence] = useState(entity.cadence);

  const clash = nameTaken(name, siblings, entity.name);
  const renamed = name !== entity.name;
  const recadenced = cadence !== entity.cadence;
  const canSave = !busy && name.trim() && !clash && (renamed || recadenced);

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Name
        </label>
        <input
          className="input"
          value={name}
          maxLength={60}
          onChange={(e) => setName(titleCase(e.target.value))}
          aria-invalid={clash ? 'true' : undefined}
          style={{ fontSize: 13, borderColor: clash ? 'var(--red)' : undefined }}
        />
        <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 4, color: clash ? 'var(--red)' : 'var(--text-muted)' }}>
          {clash ? 'You already have a set of books with that name' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {/* The plan caps businesses, and switching a set of books to one is a
            business as far as that cap goes. Offering the button and refusing
            the click would be worse than not offering it. */}
        {KINDS.filter((k) => k.value !== 'business' || canBecomeBusiness).map((k) => (
          <button
            key={k.value}
            type="button"
            className={entity.kind === k.value ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ fontSize: 11.5, padding: '4px 8px' }}
            onClick={() => onSave(entity, { kind: k.value })}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CADENCES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={cadence === c.value ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ fontSize: 11.5, padding: '4px 8px' }}
            onClick={() => setCadence(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          className="btn btn-primary"
          style={{ fontSize: 13, padding: '9px 18px' }}
          disabled={!canSave}
          onClick={() =>
            onSave(entity, {
              // Only what changed, so saving a rename never quietly restates
              // the lodgement cadence and vice versa.
              ...(renamed ? { name } : {}),
              ...(recadenced ? { cadence } : {}),
            })
          }
        >
          <Icon name="check" size={15} />
          Save changes
        </button>
        {!entity.isDefault && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11.5, padding: '4px 8px' }}
              onClick={() => onSave(entity, { isDefault: true })}
            >
              Make default
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11.5, padding: '4px 8px' }}
              onClick={() => onArchive(entity)}
            >
              Archive
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11.5, padding: '4px 8px', color: 'var(--red)' }}
              onClick={() => onDelete(entity)}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
