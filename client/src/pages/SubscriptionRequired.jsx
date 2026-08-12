import { useEffect, useState } from 'react';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import PlanComparison from '../components/PlanComparison.jsx';
import { currentPlanType, planLabel } from '../lib/plans.js';
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
  const { user, refresh } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Bumped after a request is lodged, so the plan cards refetch and the one
  // that was pressed says Pending instead of inviting a second ticket.
  const [asked, setAsked] = useState(0);
  const isOwner = user?.role === 'owner';

  // Check with Stripe before telling somebody they have lapsed.
  //
  // This page is the one place we say "you have no access", and it was saying
  // it on our own record alone. If a webhook was missed, or the payment landed
  // on another device, or they simply closed the tab before being redirected
  // back, that record is wrong and the person reading it has already paid.
  //
  // Asking Stripe here costs one call on the rarest page in the app and closes
  // the hole for good: anybody who is locked out but has actually paid is let
  // back in the moment they land on the screen that was about to tell them
  // otherwise.
  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    api
      .post('/billing/sync')
      .then((res) => {
        // Only when something actually moved. A refresh on every visit would
        // re-render this page for no reason.
        if (alive && res.data?.changed) refresh();
      })
      .catch(() => {
        // Stripe unreachable, or nothing to sync. The page is already correct
        // as far as we know, and an error here helps nobody.
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);
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

  // Stepping down rather than paying.
  //
  // Somebody who no longer wants books of their own is not "expired" — they
  // are an accountant, which this app already understands. Their records are
  // kept and come back if they ever add a plan again, and the confirmation
  // says so, because "give up my plan" sounds like losing everything and needs
  // to be shown that it is not.
  async function becomeAccountant() {
    const ok = await confirm({
      title: 'Use Taxify only to act for clients?',
      body: (
        <>
          <div style={{ marginBottom: 8 }}>
            Your own books, expenses and receipts are all kept. They stay read-only while you have no plan, and come
            straight back if you add one later.
          </div>
          <div>
            You will stop being told your access has ended, and clients can share their books with you as usual.
          </div>
        </>
      ),
      confirmLabel: 'Yes, I only act for clients',
      cancelLabel: 'Not now',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.post('/auth/become-accountant');
      await refresh();
      toast('Done — your account is set up for acting for clients', 'success');
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

        {/* Carrying on with the plan they already had.
            //
            This page only offered "ask us about" on every card, including the
            plan they were already on — so somebody who simply wanted to keep
            what they had, and pay for it, had no way to. Their only route back
            in was to raise a ticket and wait for a person, for a payment
            Stripe can take unattended.

            Renewing is a plain checkout because nothing about it needs
            deciding: same plan, published price, card details Stripe already
            has. Changing plan still goes to a ticket, which is the case that
            genuinely needs a person. */}
        {isOwner && (
          <>
            <div
              className="card"
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                border: '1px solid var(--accent)',
                background: 'var(--accent-soft)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <Icon name="repeat" size={17} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 700, fontSize: 15 }}>Carry on with {planLabel(currentPlanType(user))}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Everything picks up exactly where you left it — your books, your receipts, every year you have filed.
                Paid through Stripe and active the moment it goes through.
              </div>
              <button
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start' }}
                disabled={busy}
                onClick={() => checkout(currentPlanType(user))}
              >
                {busy && <span className="spinner" />}
                Renew my plan
              </button>
            </div>

            <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 700 }}>Or move to a different plan</div>
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

            {/* Neither paying nor lapsing. Offered here because this is the
                screen somebody is looking at when it becomes the thing they
                want — burying it in account settings would mean finding it
                while being told they cannot get in. */}
            <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 700 }}>Only here for clients?</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                If you use Taxify to look after other people’s books and not your own, you do not need a plan at all.
                Your own records are kept either way, and you can add a plan again whenever you like.
              </div>
              <button
                className="btn btn-ghost"
                style={{ alignSelf: 'flex-start', fontSize: 13 }}
                disabled={busy}
                onClick={becomeAccountant}
              >
                {busy && <span className="spinner" />}
                I only act for clients
              </button>
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
