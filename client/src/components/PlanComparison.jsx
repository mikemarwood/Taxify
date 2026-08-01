import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { usePlanChange } from '../lib/usePlanChange.js';
import Icon from './Icon.jsx';

// Both plans in full, with the current one marked. Prices come from Stripe
// rather than being written here, so what's quoted is what will be charged.
export default function PlanComparison({ user, onChoose, chooseLabel }) {
  const { changePlan, busy } = usePlanChange();
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

  // Switching plans used to say "contact support", which is not a feature.

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14, marginTop: 4 }}>
      {plans.map((plan) => {
        const current = user.planType === plan.planType;
        // The plan you already have is not something to pick again — the whole
        // card goes inert and says so, rather than offering a button that
        // would do nothing.
        const Tag = current ? 'div' : 'button';
        return (
          <motion.div
            key={plan.planType}
            whileHover={current ? undefined : { y: -3 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            style={{ display: 'flex' }}
          >
            <Tag
              type={current ? undefined : 'button'}
              aria-current={current ? 'true' : undefined}
              onClick={current || busy ? undefined : () => (onChoose ? onChoose(plan) : changePlan(plan.planType))}
              style={{
                position: 'relative',
                flex: 1,
                padding: 0,
                overflow: 'hidden',
                borderRadius: 'var(--radius)',
                border: `2px solid ${current ? 'var(--accent)' : 'var(--border)'}`,
                background: current ? 'var(--accent-soft)' : 'var(--bg-card)',
                boxShadow: current ? 'none' : 'var(--shadow-sm)',
                cursor: current ? 'default' : 'pointer',
                textAlign: 'left',
                font: 'inherit',
                color: 'var(--text)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* A banner across the top, so which one you're on is settled
                  before any of the prices are read. */}
              <div
                style={{
                  padding: '6px 14px',
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: 0.7,
                  textTransform: 'uppercase',
                  color: current ? '#fff' : 'var(--text-muted)',
                  background: current ? 'var(--accent)' : 'var(--bg-inset)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {current ? (
                  <>
                    <Icon name="check-circle" size={13} />
                    Your current plan
                  </>
                ) : (
                  <>
                    <Icon name="pointer" size={12} />
                    Select this plan
                  </>
                )}
              </div>

              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{plan.name}</span>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 24, fontWeight: 800 }}>{money(plan.amountPerYear, plan.currency)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>per year</span>
                </div>

                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{plan.tagline}</span>

                <ul style={{ margin: '2px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      <span style={{ color: current ? 'var(--accent)' : 'var(--emerald)', marginTop: 1, flexShrink: 0 }}>
                        <Icon name="check-circle" size={14} />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                <span
                  style={{
                    marginTop: 'auto',
                    paddingTop: 12,
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: current ? 'var(--text-muted)' : 'var(--accent)',
                  }}
                >
                  {current
                    ? "You're on this plan"
                    : onChoose
                    ? `${chooseLabel || 'Subscribe to'} ${plan.name} →`
                    : `Switch to ${plan.name} →`}
                </span>
              </div>
            </Tag>
          </motion.div>
        );
      })}
    </div>
  );
}
