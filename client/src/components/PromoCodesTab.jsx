import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { sentenceCase, sentenceCaseLive } from '../lib/textCase.js';
import { onCasedInput } from '../lib/casedInput.js';

// What a code will actually do if somebody types it into the sign-up form.
//
// Mirrors evaluatePromoCode on the server, in the same order, so this screen
// and the form cannot disagree about why a code was refused. Off is checked
// first because it beats everything else; expiry before redemption because a
// code can be both and the date is the one somebody can act on.
function promoState(p) {
  if (!p.active) {
    return { label: 'Off', colour: 'var(--text-muted)', background: 'var(--bg-elevated)', why: 'Switched off here' };
  }
  if (p.expiresAt && new Date(p.expiresAt) < new Date()) {
    return {
      label: 'Expired',
      colour: 'var(--red)',
      background: 'rgba(220, 38, 38, .12)',
      why: `Expired on ${new Date(p.expiresAt).toLocaleDateString()}`,
    };
  }
  if (p.maxUses !== null && p.maxUses !== undefined && p.usedCount >= p.maxUses) {
    return {
      label: 'Used up',
      colour: 'var(--red)',
      background: 'rgba(220, 38, 38, .12)',
      why: `All ${p.maxUses} uses have been taken`,
    };
  }
  return { label: 'Active', colour: 'var(--emerald)', background: 'rgba(12, 115, 67, 0.12)', why: 'Working now' };
}

// Recomputed per render rather than held in a constant, so a tab left open
// overnight does not still be offering yesterday.
function today() {
  return new Date().toISOString().slice(0, 10);
}
import { useToast } from './Toast.jsx';
import { SkeletonList } from './Skeletons.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';

// Promo codes applied during sign-up. Codes are always upper case — the field
// forces it, so a code printed on a flyer matches whatever someone types in.
export default function PromoCodesTab() {
  const confirm = useConfirm();
  const toast = useToast();
  const [codes, setCodes] = useState(null);
  // The code whose customers are being looked at, and who they are. One at a
  // time: two open lists on this screen would be two columns of email
  // addresses with nothing saying which belonged to which.
  const [usersOf, setUsersOf] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: '',
    description: '',
    planType: '',
    percentOff: '',
    amountOff: '',
    maxUses: '',
    expiresAt: '',
  });

  function load() {
    api
      .get('/admin/promo-codes')
      .then((res) => setCodes(res.data.promoCodes))
      .catch(() => setCodes([]));
  }

  useEffect(load, []);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/promo-codes', form);
      toast(`${form.code} created`, 'success');
      setForm({ code: '', description: '', planType: '', percentOff: '', amountOff: '', maxUses: '', expiresAt: '' });
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function showUsers(promo) {
    setUsersOf({ code: promo.code, loading: true, users: [] });
    try {
      const { data } = await api.get(`/admin/promo-codes/${encodeURIComponent(promo.code)}/users`);
      setUsersOf({ code: promo.code, loading: false, users: data.users });
    } catch (err) {
      toast(err.message, 'error');
      setUsersOf(null);
    }
  }

  async function toggle(promo) {
    try {
      await api.patch(`/admin/promo-codes/${promo.id}`, { active: !promo.active });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // The counter back to nothing, so a spent code can run again.
  //
  // Confirmed because it is not visibly destructive and reads as tidying up:
  // pressing it on a live code silently gives away another run of discounts,
  // and the number that says how many have gone is the number it erases. The
  // dialog states both halves — what comes back, and what does not.
  async function resetUses(promo) {
    const ok = await confirm({
      title: `Reset the count on ${promo.code}?`,
      body:
        `It has been used ${promo.usedCount} time${promo.usedCount === 1 ? '' : 's'}` +
        (promo.maxUses ? ` of ${promo.maxUses}` : '') +
        '. The count goes back to zero and the code can be used again from the start. ' +
        'Anyone who has already had the discount cannot take it a second time, and the expiry date is not changed.',
      confirmLabel: 'Reset the count',
    });
    if (!ok) return;
    try {
      await api.post(`/admin/promo-codes/${promo.id}/reset`, {});
      toast(`${promo.code} is back to zero uses`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(promo) {
    if (
      !(await confirm({
        tone: 'danger',
        title: `Delete ${promo.code}?`,
        body:
          'It comes off any account still waiting to use it, so nobody is left holding a code that cannot work. ' +
          'Accounts that already had the discount are unaffected.',
        confirmLabel: 'Delete',
      }))
    )
      return;
    try {
      const res = await api.delete(`/admin/promo-codes/${promo.id}`);
      const freed = res.data?.clearedFrom || 0;
      toast(
        freed ? `${promo.code} deleted and taken off ${freed} account${freed === 1 ? '' : 's'}` : `${promo.code} deleted`,
        'success'
      );
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // A code with no discount would be accepted at sign-up and change nothing,
  // which reads as a bug to whoever typed it.
  const canCreate = form.code.trim().length >= 3 && (form.percentOff || form.amountOff);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <form onSubmit={create} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700 }}>New promo code</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <div>
            <label className="label">Code</label>
            <input
              className="input"
              value={form.code}
              maxLength={40}
              placeholder="SPRING25"
              style={{ textTransform: 'uppercase' }}
              onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            {/* sentenceCaseLive, not sentenceCase. The trimming version
                collapses runs of whitespace — right on submit, ruinous per
                keystroke: the space between two words was deleted the instant
                it was typed, so this box could only ever hold one word. */}
            <input
              className="input"
              value={form.description}
              maxLength={255}
              placeholder="Spring campaign — 25% off the first year"
              onChange={onCasedInput(sentenceCaseLive, (value) => set('description', value))}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
          <div>
            <label className="label">Percent off</label>
            <input
              className="input"
              type="number"
              min="1"
              max="100"
              value={form.percentOff}
              placeholder="25"
              onChange={(e) => set('percentOff', e.target.value)}
            />
          </div>
          <div>
            <label className="label">or Amount off</label>
            <input
              className="input"
              type="number"
              min="1"
              step="0.01"
              value={form.amountOff}
              placeholder="10.00"
              onChange={(e) => set('amountOff', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Applies to</label>
            <select className="input" value={form.planType} onChange={(e) => set('planType', e.target.value)}>
              <option value="">Any plan</option>
              <option value="individual">Individual only</option>
              <option value="business">Small Business only</option>
            </select>
          </div>
          <div>
            <label className="label">Max uses</label>
            <input
              className="input"
              type="number"
              min="1"
              value={form.maxUses}
              placeholder="Unlimited"
              onChange={(e) => set('maxUses', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Expires</label>
            {/* A code that expired before it was made is not a code. The
                picker refuses yesterday rather than accepting it and having
                the code silently never work. */}
            <input
              className="input"
              type="date"
              min={today()}
              value={form.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
            />
          </div>
        </div>

        <button className="btn btn-primary" type="submit" disabled={busy || !canCreate} style={{ alignSelf: 'flex-start' }}>
          {busy && <span className="spinner" />}
          Create code
        </button>
      </form>

      {codes === null ? (
        <SkeletonList rows={3} />
      ) : codes.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          No promo codes yet. Anything created here can be entered on the sign-up form.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {codes.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 18px',
                borderBottom: i < codes.length - 1 ? '1px solid var(--border)' : 'none',
                opacity: p.active ? 1 : 0.55,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontFamily: 'Consolas, monospace', fontWeight: 700, fontSize: 14 }}>{p.code}</span>

              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {p.percentOff ? `${p.percentOff}% off` : `$${p.amountOff} off`}
              </span>

              {p.planType && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{p.planType} only</span>}

              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12.5,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.description}
              </span>

              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {p.usedCount}
                {p.maxUses ? ` / ${p.maxUses}` : ''} used
              </span>

              {p.expiresAt && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  until {new Date(p.expiresAt).toLocaleDateString()}
                </span>
              )}

              {/* Active is not the same as usable.
                  A code switched on, fully redeemed and three weeks past its
                  expiry read "Active" here while the sign-up form refused it —
                  so the one screen for answering "why did this not work" said
                  the opposite of what the customer was seeing. */}
              {(() => {
                const state = promoState(p);
                return (
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: 999,
                      whiteSpace: 'nowrap',
                      color: state.colour,
                      background: state.background,
                    }}
                    title={state.why}
                  >
                    {state.label}
                  </span>
                );
              })()}

              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '6px 12px' }}
                disabled={!p.usedCount}
                title={p.usedCount ? 'Who used this code' : 'Nobody has used this code yet'}
                onClick={() => showUsers(p)}
              >
                Who used it
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '6px 12px' }}
                disabled={!p.usedCount}
                title={p.usedCount ? 'Put the used count back to zero' : 'Nothing to reset — it has never been used'}
                onClick={() => resetUses(p)}
              >
                Reset count
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => toggle(p)}>
                {p.active ? 'Disable' : 'Enable'}
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '6px 12px', color: 'var(--red)' }}
                onClick={() => remove(p)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {usersOf && (
        <div
          className="card"
          style={{ marginTop: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 14 }}>
              Signed up with <code>{usersOf.code}</code>
            </strong>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {usersOf.loading ? 'Loading…' : `${usersOf.users.length} account${usersOf.users.length === 1 ? '' : 's'}`}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setUsersOf(null)}>
              Close
            </button>
          </div>

          {!usersOf.loading && usersOf.users.length === 0 && (
            /* The count and this list can disagree, and the difference is
               information rather than a fault: the count is redemptions ever,
               this is customers who still exist. A code used twice by accounts
               since deleted shows two uses and nobody here. */
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Nobody with an account still open used this code. The use count includes accounts that have since been
              deleted.
            </div>
          )}

          {usersOf.users.map((u) => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'baseline',
                fontSize: 12.5,
                padding: '6px 0',
                borderTop: '1px solid var(--border)',
              }}
            >
              <span style={{ fontWeight: 600, minWidth: 140 }}>{u.name}</span>
              <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 180 }}>{u.email}</span>
              <span style={{ color: 'var(--text-muted)' }}>{u.planType || '—'}</span>
              <span style={{ color: u.activated ? 'var(--text-muted)' : 'var(--red)' }}>
                {u.activated ? new Date(u.joinedAt).toLocaleDateString() : 'never activated'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
