import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';

// Both plans in full, with the current one marked. Prices come from Stripe
// rather than being written here, so what's quoted is what will be charged.
export default function PlanComparison({ user, onChoose, chooseLabel }) {
  const toast = useToast();
  const [plans, setPlans] = useState(null);

  useEffect(() => {
    api
      .get('/auth/plans')
      .then((res) => setPlans(res.data.plans))
      .catch(() => setPlans([]));
  }, []);

  if (!plans || plans.length === 0) return null;

  function money(cents, currency) {
    if (cents === null || cents === undefined) return '—';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'AUD',
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  }

  function defaultChoose(plan) {
    toast(
      plan.planType === 'family'
        ? 'To move to the Family plan, contact support and we’ll switch it over.'
        : 'To move to the Individual plan, remove your second login first, then contact support.',
      'info'
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginTop: 4 }}>
      {plans.map((plan) => {
        const current = user.planType === plan.planType;
        return (
          <div
            key={plan.planType}
            style={{
              padding: 15,
              borderRadius: 'var(--radius)',
              border: `2px solid ${current ? 'var(--accent)' : 'var(--border)'}`,
              background: current ? 'var(--accent-soft)' : 'var(--bg-elevated)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>{plan.name}</span>
              {current && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: 'var(--accent)',
                    color: '#fff',
                  }}
                >
                  YOUR PLAN
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 21, fontWeight: 800 }}>{money(plan.amountPerYear, plan.currency)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>per year</span>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{plan.tagline}</span>

            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.65 }}>
              {plan.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>

            {(onChoose || !current) && (
              <button
                type="button"
                className={onChoose && current ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ fontSize: 12.5, marginTop: 'auto' }}
                onClick={() => (onChoose ? onChoose(plan) : defaultChoose(plan))}
              >
                {onChoose ? `${chooseLabel || 'Subscribe to'} ${plan.name}` : `Switch to ${plan.name}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
