import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { sentenceCase } from '../lib/textCase.js';

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

  async function toggle(promo) {
    try {
      await api.patch(`/admin/promo-codes/${promo.id}`, { active: !promo.active });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(promo) {
    if (!(await confirm({ tone: 'danger', title: `Delete ${promo.code}?`, body: 'Accounts that already used it are unaffected.', confirmLabel: 'Delete' }))) return;
    try {
      await api.delete(`/admin/promo-codes/${promo.id}`);
      toast(`${promo.code} deleted`, 'success');
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
            <input
              className="input"
              value={form.description}
              maxLength={255}
              placeholder="Spring campaign — 25% off the first year"
              onChange={(e) => set('description', sentenceCase(e.target.value))}
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

              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: 999,
                  color: p.active ? 'var(--emerald)' : 'var(--text-muted)',
                  background: p.active ? 'rgba(12, 115, 67, 0.12)' : 'var(--bg-elevated)',
                }}
              >
                {p.active ? 'Active' : 'Off'}
              </span>

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
    </div>
  );
}
