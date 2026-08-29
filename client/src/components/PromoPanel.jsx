import { useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';

// The promo code on the account, above the plans.
//
// A code typed on the sign-up form was written to the account and then never
// spoken of again: the plans page quoted the full price, and the discount only
// appeared on Stripe's own checkout page. Somebody who had been given twenty
// per cent off had no way to know it had survived their sign-up, which is the
// one thing they want to know before pressing a button that takes money.
//
// So the code is stated, what it takes off is stated, and — for anybody who
// was sent a code after they joined — there is somewhere to type one, which
// there never was outside registration.

// What a code is worth, in words, from whichever of the two shapes it has.
export function promoWorth(promo) {
  if (!promo) return '';
  if (promo.percentOff) return `${Number(promo.percentOff)}% off your first year`;
  if (promo.amountOff) return `$${Number(promo.amountOff).toFixed(2)} off your first year`;
  return promo.description || 'applied to your first year';
}

export default function PromoPanel({ state, onChange, canEdit = true }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  if (!state) return null;
  const promo = state.promo;

  async function apply() {
    const typed = code.trim();
    if (!typed || saving) return;
    setSaving(true);
    try {
      const res = await api.post('/billing/promo', { code: typed });
      setCode('');
      onChange?.(res.data);
      toast('Promo code applied', 'success');
    } catch (err) {
      toast(err?.response?.data?.error || err?.message || 'That code could not be applied', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Already has one. Stated rather than offered, because a second code is
  // refused by the server and a box that is always refused is worse than no
  // box — see the route for why one per account is the rule.
  if (promo) {
    const spent = state.redeemed || state.usable === false;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 11,
          padding: '12px 14px',
          borderRadius: 'var(--radius)',
          border: `1px solid ${spent ? 'var(--border)' : 'var(--emerald)'}`,
          background: spent ? 'var(--bg-inset)' : 'var(--bg-card)',
          marginBottom: 14,
        }}
      >
        <span style={{ color: spent ? 'var(--text-muted)' : 'var(--emerald)', marginTop: 1, flexShrink: 0 }}>
          <Icon name={spent ? 'check-circle' : 'tag'} size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>
            Promo code {promo.code}
            {promo.planType ? ` · ${promo.planType === 'business' ? 'Small Business' : 'Individual'} only` : ''}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {state.redeemed
              ? 'Already used on this account — it came off your first payment.'
              : state.usable === false
              ? 'This code is no longer valid, so the prices below are the ones you will be charged.'
              : `${promoWorth(promo)}. It comes off automatically when you pay — the prices below already show it.`}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 4 }}>
            One promo code per account, so this is the one that applies.
          </div>
        </div>
      </div>
    );
  }

  if (!canEdit) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        flexWrap: 'wrap',
        padding: '11px 14px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        marginBottom: 14,
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color: 'var(--text-muted)' }}>
          <Icon name="tag" size={15} />
        </span>
        Have a promo code?
      </span>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder="SPRING25"
        aria-label="Promo code"
        maxLength={40}
        disabled={saving}
        style={{
          flex: '1 1 150px',
          minWidth: 0,
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-inset)',
          color: 'var(--text)',
          font: 'inherit',
          fontSize: 13,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      />
      <button className="btn btn-secondary" style={{ fontSize: 12.5 }} disabled={!code.trim() || saving} onClick={apply}>
        {saving && <span className="spinner" />}
        Apply
      </button>
      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', flexBasis: '100%' }}>
        One per account, and it comes off your first year only.
      </span>
    </div>
  );
}
