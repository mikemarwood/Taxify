import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { usePlanChange } from '../lib/usePlanChange.js';
import { useBillingAttention } from '../lib/useBillingAttention.js';
import { currentPlanType } from '../lib/plans.js';
import PlanChangeDialog from './PlanChangeDialog.jsx';
import Icon from './Icon.jsx';

// Both plans in full, with the current one marked. Prices come from Stripe
// rather than being written here, so what's quoted is what will be charged.
// fresh: nobody is on a plan yet, so no card is "the one you are on".
//
// currentPlanType resolves a missing plan_type to Individual, which is right
// when the question is "which of these are you on" and wrong when the answer is
// neither. An accountant taking their first plan would have found Individual
// marked as theirs and inert — one pickable card, and no way to pick the other.
export default function PlanComparison({ user, onChoose, chooseLabel, refreshKey = 0, fresh = false }) {
  const { changePlan, busy, pending, confirmChange, cancelChange } = usePlanChange();
  const [plans, setPlans] = useState(null);
  // A move already asked for. Offering the same card again produced a second
  // ticket for a question already in the queue, and the person asking had no
  // sign that the first one had landed.
  //
  // Polled rather than fetched once. Paying happens in Stripe — another tab,
  // or a phone — so the card has to change on its own when the money lands,
  // not on the next full page load.
  const { request: asked, refresh: refreshAsked } = useBillingAttention();

  useEffect(() => {
    api
      .get('/auth/plans')
      .then((res) => setPlans(res.data.plans))
      .catch(() => setPlans([]));
  }, []);

  // The caller bumps this after lodging one, so the card flips straight away
  // rather than at the next tick.
  useEffect(() => {
    if (refreshKey) refreshAsked();
  }, [refreshKey, refreshAsked]);

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
    <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14, marginTop: 4 }}>
      {plans.map((plan) => {
        // Through the shared resolver, not a raw ===. A NULL plan_type used to
        // match neither card while the heading above said Individual.
        const current = !fresh && currentPlanType(user) === plan.planType;
        // Already asked for, and still being dealt with. The card says so and
        // goes inert, the same as the plan you are already on — the difference
        // is that this one points at the conversation.
        const waiting = !current && asked?.toPlan === plan.planType;

        // Moving down, while the plan they are on is still paid for.
        //
        // The server refuses this, but refusing it there and offering it here
        // means somebody reads the card, presses it, confirms a dialog, and is
        // then told no — three steps to find out about a rule that could have
        // been stated on the card. Individual covers fewer sets of books, so a
        // downgrade mid-year shuts books they have paid to the end of the year
        // for. Once the plan lapses there is nothing left to take away and the
        // card offers itself normally.
        const tooEarly =
          !fresh &&
          !current &&
          plan.planType === 'individual' &&
          currentPlanType(user) === 'business' &&
          !user?.accessLocked;
        const invoiced = waiting && asked?.status === 'invoiced';
        // The plan you already have is not something to pick again — the whole
        // card goes inert and says so, rather than offering a button that
        // would do nothing.
        const inert = current || waiting || tooEarly;
        const Tag = inert ? 'div' : 'button';
        return (
          <motion.div
            key={plan.planType}
            whileHover={inert ? undefined : { y: -3 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            style={{ display: 'flex' }}
          >
            <Tag
              type={inert ? undefined : 'button'}
              aria-current={current ? 'true' : undefined}
              onClick={inert || busy ? undefined : () => (onChoose ? onChoose(plan) : changePlan(plan.planType))}
              style={{
                position: 'relative',
                flex: 1,
                padding: 0,
                overflow: 'hidden',
                borderRadius: 'var(--radius)',
                border: `2px solid ${current ? 'var(--accent)' : waiting || tooEarly ? 'var(--text-muted)' : 'var(--border)'}`,
                background: current ? 'var(--accent-soft)' : 'var(--bg-card)',
                boxShadow: inert ? 'none' : 'var(--shadow-sm)',
                cursor: inert ? 'default' : 'pointer',
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
                  background: current ? 'var(--accent)' : waiting || tooEarly ? 'var(--bg-subtle)' : 'var(--bg-inset)',
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
                ) : waiting ? (
                  <>
                    <Icon name="clock" size={12} />
                    Pending · {invoiced ? 'invoice sent' : 'with us'}
                  </>
                ) : tooEarly ? (
                  <>
                    <Icon name="lock" size={12} />
                    Available when your plan ends
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
                    color: inert ? 'var(--text-muted)' : 'var(--accent)',
                  }}
                >
                  {current
                    ? "You're on this plan"
                    : tooEarly
                    ? user?.subscriptionCurrentPeriodEnd
                      ? `You can move down when Small Business ends on ${new Date(
                          user.subscriptionCurrentPeriodEnd
                        ).toLocaleDateString()} — it covers more books than this one`
                      : 'You can move down when your current plan ends — it covers more books than this one'
                    : waiting
                    ? invoiced
                      ? 'Already asked for — the invoice is on its way'
                      : 'Already asked for — we are looking at it'
                    : onChoose
                    ? `${chooseLabel || 'Subscribe to'} ${plan.name} →`
                    : `Switch to ${plan.name} →`}
                </span>

                {/* Where the answer will arrive. A card that says "pending"
                    and nothing else leaves somebody with nowhere to go and no
                    way to chase it. */}
                {waiting && asked?.ticketId && (
                  <Link
                    to={`/support/${asked.ticketId}`}
                    style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}
                  >
                    Open the conversation{asked.ticketReference ? ` · ${asked.ticketReference}` : ''} →
                  </Link>
                )}
              </div>
            </Tag>
          </motion.div>
        );
      })}
    </div>

    {/* The figure it quotes comes from Stripe's own preview of the invoice it
        is about to raise, so what is shown here is what gets charged. */}
    {pending && (
      <PlanChangeDialog
        planType={pending}
        busy={busy}
        onConfirm={confirmChange}
        onCancel={cancelChange}
      />
    )}
    </>
  );
}
