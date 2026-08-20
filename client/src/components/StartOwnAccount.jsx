import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import PlanComparison from './PlanComparison.jsx';
import Icon from './Icon.jsx';

// An accountant taking an ordinary Taxify account on the same login.
//
// It was one button that did it immediately, on Individual, because that is
// what the endpoint hardcoded — the plan was picked for them, and a single
// press changed what their login is with nothing in between.
//
// The plans are drawn by PlanComparison, the same component the billing page
// and the lapsed-plan page use. My first attempt described the two plans in a
// list written here, which meant a second description of the same products
// with its own wording and no prices at all — the real cards come from Stripe,
// so what they quote is what will actually be charged. Two descriptions of one
// product is one that will go out of date.
//
// fresh, because an accountant is on no plan at all. Without it the Individual
// card would mark itself as theirs and go inert, leaving one pickable card.
//
// Offered in two places — the client list and account settings — which is why
// this is a component rather than written twice.

// onOpenChange lets the page around it know the question is open, so a page
// whose other content is about something else can stand down while it is asked.
export default function StartOwnAccount({ label = 'Start tracking my own expenses', onOpenChange }) {
  const { user, refresh } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();

  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    setChoosing(false);
    onOpenChange?.(false);
  }

  async function start(plan) {
    const ok = await confirm({
      title: `Start your own account on ${plan.name}?`,
      body:
        'This login becomes an ordinary Taxify account as well as an accountant one. Your 14-day trial starts ' +
        'today, nothing is charged until it ends, and every client you already act for stays exactly as it is. ' +
        'You can change plan later from My account.',
      confirmLabel: `Start on ${plan.name}`,
      cancelLabel: 'Not yet',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api.post('/auth/start-own-account', { planType: plan.planType });
      await refresh();
      // A trial is granted once per account ever, so somebody who has had
      // theirs is told what actually happened rather than promised fourteen
      // days they are not getting. The server says which it was.
      toast(
        res.data?.trialGranted
          ? `Your ${plan.name} account is ready — your 14-day trial has started`
          : `Your ${plan.name} account is ready — add a payment method to open your books`,
        'success'
      );
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  if (!choosing) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: 13, alignSelf: 'flex-start' }}
        onClick={() => {
          setChoosing(true);
          onOpenChange?.(true);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left', flex: '1 1 100%' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Start your own account</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.6 }}>
          Your login keeps every client you act for and gains books of its own. Choose a plan to trial — 14 days
          free, nothing charged until it ends, and you can change plan later from My account.
        </p>
      </div>

      {/* busy is not passed down: PlanComparison owns its own, and while the
          confirmation is up the press has already been made. */}
      <PlanComparison user={user} fresh onChoose={start} chooseLabel="Start on" />

      <div>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 13, gap: 7 }} disabled={busy} onClick={close}>
          <Icon name="arrow-left" size={15} />
          Back
        </button>
      </div>
    </div>
  );
}
