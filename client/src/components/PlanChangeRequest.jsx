import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { formatDateLong } from '../lib/dates.js';
import { planLabel } from '../lib/plans.js';

// Asking to change plan, for the cases self-serve checkout cannot handle.
//
// Stripe's own switch prorates instantly, but it only works for somebody who
// already has a live subscription — which excludes every account on a granted
// plan, everyone whose subscription has lapsed, and any move that needs a
// price the published list does not carry. Those all used to end at a card
// that offered a button doing nothing useful.
//
// Here the request goes to an administrator, who quotes it and sends an
// invoice. The plan moves when Stripe says the invoice was paid, never before.
export default function PlanChangeRequest({ user, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);

  // The plan they are not on. With two plans this is the whole choice, and
  // asking someone to pick from a list of one is worse than naming it.
  const target = user?.planType === 'business' ? 'individual' : 'business';

  function load() {
    api
      .get('/billing/plan-change-request')
      .then((res) => setRequest(res.data.request))
      .catch(() => setRequest(null))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function ask() {
    setBusy(true);
    try {
      const res = await api.post('/billing/plan-change-request', { planType: target, note: note.trim() || null });
      setRequest(res.data.request);
      setAsking(false);
      setNote('');
      toast('Sent — we will email you an invoice', 'success');
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (
      !(await confirm({
        title: 'Cancel this request?',
        body:
          request?.status === 'invoiced'
            ? 'The invoice you were sent will not be collected. Nothing has been charged.'
            : 'Nothing has been charged.',
        confirmLabel: 'Cancel request',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.delete(`/billing/plan-change-request/${request.id}`);
      setRequest(null);
      toast('Request cancelled', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  const money = (cents, currency) =>
    cents == null
      ? null
      : new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: (currency || 'AUD').toUpperCase(),
          minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
        }).format(cents / 100);

  // Waiting on us, or waiting on them.
  if (request) {
    const invoiced = request.status === 'invoiced';
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderLeft: `3px solid ${invoiced ? 'var(--amber)' : 'var(--accent)'}`,
          borderRadius: 10,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'var(--bg-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={invoiced ? 'credit-card' : 'info'} size={15} style={{ color: invoiced ? 'var(--amber)' : 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {invoiced ? 'Your invoice is ready' : `Change to ${planLabel(request.toPlan)} requested`}
          </span>
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {invoiced ? (
            <>
              {money(request.invoiceAmountCents, request.invoiceCurrency)} to move to{' '}
              <strong style={{ color: 'var(--text)' }}>{planLabel(request.toPlan)}</strong>. Your plan changes over as
              soon as the payment clears — you do not need to do anything else here.
            </>
          ) : (
            <>
              Asked {formatDateLong(request.createdAt)}. We will send you an invoice, and the plan moves across once it
              is paid.
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {invoiced && request.invoiceUrl && (
            <a
              className="btn btn-primary"
              href={request.invoiceUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13, textDecoration: 'none' }}
            >
              Pay invoice
            </a>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 12.5 }} disabled={busy} onClick={cancel}>
            Cancel request
          </button>
        </div>
      </div>
    );
  }

  if (!asking) {
    return (
      <button
        className="btn btn-ghost"
        style={{ fontSize: 13, alignSelf: 'flex-start', gap: 7 }}
        onClick={() => setAsking(true)}
      >
        <Icon name="mail" size={14} />
        Ask us to move you to {planLabel(target)}
      </button>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Move to {planLabel(target)}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        We will work out what you owe for the rest of your year and email you an invoice. Nothing is charged until you
        pay it, and your plan stays exactly as it is until then.
      </div>
      <textarea
        className="input"
        rows={3}
        maxLength={500}
        placeholder="Anything we should know? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy} onClick={ask}>
          {busy && <span className="spinner" />}
          Send request
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 13 }} disabled={busy} onClick={() => setAsking(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}
