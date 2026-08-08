import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import { titleCase, titleCaseLive } from '../lib/textCase.js';
import Icon from './Icon.jsx';
import { playClick } from '../lib/sounds.js';
import { useConfirm } from '../lib/ConfirmContext.jsx';

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

// Long enough to be a name, short enough to fit the picker and the sidebar
// without being cut off. Spaces are counted after collapsing runs of them, so
// trailing whitespace can't be used to pad a one-character name past the floor.
const NAME_MIN = 2;
const NAME_MAX = 40;

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

// The message under the field, or '' when there is nothing to say. Returned
// rather than thrown so the same call can both disable the button and label
// the reason.
function nameProblem(value, all, ignore = null) {
  const text = cleanName(value);
  if (!text) return '';
  if (text.length < NAME_MIN) return `At least ${NAME_MIN} characters`;
  if (text.length > NAME_MAX) return `At most ${NAME_MAX} characters`;
  if (nameTaken(text, all, ignore)) return 'You already have a set of books with that name';
  return '';
}

export default function EntityManager() {
  const confirm = useConfirm();
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
  const createProblem = nameProblem(name, allNames);

  // An account has one individual return, and the server refuses a second. The
  // button is dropped rather than offered and then rejected — archived books
  // count, because the name and the slot are both still taken until one is
  // deleted.
  const hasIndividual = allNames.some((e) => e.kind === 'individual');
  const kindChoices = KINDS.filter((k) => k.value !== 'individual' || !hasIndividual);

  // If the selected kind is no longer on offer — an individual created in
  // another tab while this form was open — fall back rather than leave the
  // form with nothing highlighted and a value the server will refuse.
  const activeKind = kindChoices.some((k) => k.value === kind) ? kind : kindChoices[0]?.value;

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
      const { data } = await api.post('/entities', { name: cleanName(name), kind: activeKind, cadence });
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

      // Making a set of books the default switches to it as well. The default
      // is remembered per browser, and a browser that already had a selection
      // kept showing the old one — so pressing "Make default" appeared to do
      // nothing at all in the sidebar or the expense form.
      if (changes.isDefault === true) choose(entity.id);

      setEditing(null);
      toast('Saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function archive(entity) {
    if (!(await confirm({ title: `Archive ${entity.name}?`, body: 'Everything in it is kept — it just stops appearing in the picker, and it still counts against your plan.', confirmLabel: 'Archive' }))) return;
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

  // Deleting a set of books used to live here. It destroyed every expense,
  // receipt and lodgement inside them and sat one press from Save with only a
  // dialog in between. Archiving is what people mean when they say "get rid of
  // this", and it can be undone. The server route still exists for a genuine
  // deletion, asked for deliberately.

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
                // The card being edited takes the whole row. Sharing it means
                // the name field, both button groups and Save are squeezed into
                // half the page while the space beside it sits empty.
                flex: editing === e.id ? '1 1 100%' : '1 1 260px',
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
                maxLength={NAME_MAX}
                value={name}
                // titleCaseLive, not titleCase: the latter trims, so the space
                // between two words was deleted as soon as it was typed and a
                // name could never be more than one word.
                onChange={(ev) => setName(titleCaseLive(ev.target.value))}
                onBlur={() => setName(titleCase(name))}
                placeholder="e.g. Marwood Plumbing"
                aria-invalid={createProblem ? 'true' : undefined}
                style={createProblem ? { borderColor: 'var(--red)' } : undefined}
              />
              <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 5, color: createProblem ? 'var(--red)' : 'var(--text-muted)' }}>
                {createProblem || `${NAME_MIN}–${NAME_MAX} characters. Spaces are fine.`}
              </div>
            </div>

            <div>
              <label className="label">What is it</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {kindChoices.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => pickKind(k.value)}
                    className={activeKind === k.value ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ fontSize: 12.5, padding: '7px 12px' }}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {activeKind === 'business'
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

            <button className="btn btn-primary" disabled={busy || !cleanName(name) || Boolean(createProblem)} style={{ justifySelf: 'start' }}>
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

function EditRow({ entity, busy, canBecomeBusiness, siblings = [], onSave, onArchive }) {
  const [name, setName] = useState(entity.name);
  // Held here until Save. Pressing "Every quarter" used to change how the
  // books lodge the instant it was pressed, with nothing to confirm and
  // nothing to undo — a decision that belongs to the same Save as the name.
  const [cadence, setCadence] = useState(entity.cadence);

  const problem = nameProblem(name, siblings, entity.name);
  const renamed = cleanName(name) !== entity.name;
  const recadenced = cadence !== entity.cadence;
  const canSave = !busy && cleanName(name) && !problem && (renamed || recadenced);

  // Each group is a labelled row rather than a bare line of buttons. Without
  // the labels this was a stack of chips — "Individual", then "Once a year" —
  // with nothing saying what either of them was choosing.
  const groupLabel = { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 };
  const chip = { fontSize: 12.5, padding: '7px 13px' };

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 12, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Name
        </label>
        <input
          className="input"
          value={name}
          maxLength={NAME_MAX}
          // titleCaseLive while typing — titleCase trims, so the space between
          // two words vanished the moment it was typed.
          onChange={(e) => setName(titleCaseLive(e.target.value))}
          onBlur={() => setName(titleCase(name))}
          aria-invalid={problem ? 'true' : undefined}
          style={{ fontSize: 13, borderColor: problem ? 'var(--red)' : undefined }}
        />
        <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 4, color: problem ? 'var(--red)' : 'var(--text-muted)' }}>
          {problem || `${NAME_MIN}–${NAME_MAX} characters. Spaces are fine.`}
        </div>
      </div>

      <div>
        <div style={groupLabel}>What it is</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* The plan caps businesses, and switching a set of books to one is a
              business as far as that cap goes. Offering the button and refusing
              the click would be worse than not offering it. */}
          {KINDS.filter((k) => k.value !== 'business' || canBecomeBusiness).map((k) => (
            <button
              key={k.value}
              type="button"
              className={entity.kind === k.value ? 'btn btn-primary' : 'btn btn-ghost'}
              style={chip}
              onClick={() => onSave(entity, { kind: k.value })}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={groupLabel}>How often it lodges</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CADENCES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={cadence === c.value ? 'btn btn-primary' : 'btn btn-ghost'}
              style={chip}
              onClick={() => setCadence(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save on its own line above a rule, then the things that are not
          saving. Previously Delete sat immediately beside Save at the same
          size, which is a bad place to keep an irreversible button. */}
      <div style={{ display: 'grid', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: 13, padding: '10px 20px', justifySelf: 'start' }}
          disabled={!canSave}
          onClick={() =>
            onSave(entity, {
              // Only what changed, so saving a rename never quietly restates
              // the lodgement cadence and vice versa.
              ...(renamed ? { name: cleanName(name) } : {}),
              ...(recadenced ? { cadence } : {}),
            })
          }
        >
          <Icon name="check" size={15} />
          Save changes
        </button>

        {!entity.isDefault && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '6px 11px' }}
                onClick={() => onSave(entity, { isDefault: true })}
              >
                Make default
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '6px 11px' }}
                onClick={() => onArchive(entity)}
              >
                Archive
              </button>
            </div>

            {/* Deleting was here and is gone. It destroyed every expense,
                receipt and lodgement in the books along with them, and it sat
                one press from Save with nothing but a dialog in between. What
                somebody actually wants when they say "get rid of this" is
                archiving, so that is the only thing offered. A genuine
                deletion is rare enough to be worth asking for. */}
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text)' }}>Archiving</strong> hides these books from the picker and from
              your reports. Nothing is deleted — every expense, receipt and lodgement is kept, and you can restore them
              at any time from below. Archived books still count towards your plan's limit.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
