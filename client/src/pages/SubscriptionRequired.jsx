import { useState } from 'react';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { Link } from 'react-router-dom';
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
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Bumped after a request is lodged, so the plan cards refetch and the one
  // that was pressed says Pending instead of inviting a second ticket.
  const [asked, setAsked] = useState(0);
  const isOwner = user?.role === 'owner';
  const billing = describeSubscription(user);

  // Asks us to move them rather than opening Stripe.
  //
  // This page is only shown to somebody whose access has lapsed — precisely the
  // account Stripe's own switch cannot serve, because there is no live
  // subscription to change. An administrator quotes it and sends an invoice,
  // and the ticket keeps the whole thing in one conversation.
  async function requestPlan(plan) {
    // Asked before anything is lodged. Pressing a plan card and silently
    // raising a ticket is a decision made on somebody's behalf — and this page
    // is reached by people who are already frustrated, so it should be obvious
    // what a press does.
    const ok = await confirm({
      title: `Move to ${plan.name}?`,
      body: (
        <>
          <div style={{ marginBottom: 8 }}>
            We will work out what you owe and email you an invoice. Nothing is charged until you pay it.
          </div>
          <div>Pressing yes lodges a support ticket, so you can follow it and reply to us in one place.</div>
        </>
      ),
      confirmLabel: 'Yes, ask us to move me',
      cancelLabel: 'Not now',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.post('/billing/plan-change-request', { planType: plan.planType });
      // So the card they just pressed flips to Pending rather than sitting
      // there still inviting a second identical ticket.
      setAsked((n) => n + 1);
      toast('Sent — we will email you an invoice', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

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

          {/* Their own side has lapsed, but the clients who invited them are a
              separate matter entirely — an accountant is never billed for
              reading someone else's books. */}
          {user?.isAccountant && (
            <Link to="/clients" className="btn btn-ghost" style={{ marginTop: 16, fontSize: 13 }}>
              <Icon name="briefcase" size={15} />
              This doesn't affect your clients — open their books
            </Link>
          )}
        </div>

        {isOwner && (
          <>
            <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 700 }}>Choose your plan</div>
              <PlanComparison
                user={user}
                onChoose={(plan) => !busy && requestPlan(plan)}
                chooseLabel="Ask us about"
                refreshKey={asked}
              />
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

            {user?.stripeCustomerId && (
            <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              Already paid, or need to update your card?{' '}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12.5 }}
                disabled={busy}
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
                {busy && <span className="spinner" />}
                Open the billing portal
              </button>
            </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
