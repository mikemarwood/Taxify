import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import PlanComparison from '../components/PlanComparison.jsx';
import { describeSubscription } from '../lib/subscription.js';

// Someone who lands here has lost access to their own records, so the page
// answers the two questions they will actually have — what happened to my data,
// and what exactly am I paying for — before asking for a card.
const REASSURANCES = [
  {
    icon: 'shield',
    title: 'Nothing has been deleted',
    body: 'Every expense, receipt and property document is exactly where you left it. Subscribing restores access immediately.',
  },
  {
    icon: 'download',
    title: 'Your records stay yours',
    body: 'Once you are back in you can download the whole financial year — the summary spreadsheet, the PDF and every receipt — as a single zip.',
  },
  {
    icon: 'lock',
    title: 'Cancel whenever you like',
    body: 'Billing is yearly and managed through Stripe. You can cancel or update your card from the billing portal at any time.',
  },
];

export default function SubscriptionRequired() {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isOwner = user?.role === 'owner';
  const billing = describeSubscription(user);

  async function checkout(planType) {
    setBusy(true);
    try {
      const res = await api.post('/billing/checkout', { planType });
      window.location.href = res.data.url;
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 20px 60px' }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ maxWidth: 760, width: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div className="card" style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: 'var(--violet)' }}>
            <Icon name="lock" size={30} />
          </div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>
            {billing.state === 'past_due' ? 'Your last payment failed' : 'Your free trial has ended'}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
            {isOwner
              ? 'Your data is safe and waiting for you. Choose a yearly plan below to restore access to your expenses, reports and receipts.'
              : 'Access for this account is managed by your account holder. Ask them to subscribe to restore access.'}
          </p>
        </div>

        {isOwner && (
          <>
            <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 700 }}>Choose your plan</div>
              <PlanComparison user={user} onChoose={(plan) => !busy && checkout(plan.planType)} chooseLabel="Subscribe to" />
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Prices are in AUD and billed yearly. Payment is handled by Stripe — Taxify never sees your card details.
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {REASSURANCES.map((item) => (
                <div key={item.title} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <span style={{ color: 'var(--accent)' }}>
                    <Icon name={item.icon} size={17} />
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{item.body}</span>
                </div>
              ))}
            </div>

            <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
              Already paid, or need to update your card?{' '}
              <button
                type="button"
                className="link-button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api.post('/billing/portal');
                    window.location.href = res.data.url;
                  } catch (err) {
                    toast(err.message, 'error');
                    setBusy(false);
                  }
                }}
              >
                Open the billing portal
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
