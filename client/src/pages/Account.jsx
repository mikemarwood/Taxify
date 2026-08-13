import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import OtpBenefits from '../components/OtpBenefits.jsx';
import Toggle from '../components/Toggle.jsx';
import Avatar from '../components/Avatar.jsx';
import AvatarEditorModal from '../components/AvatarEditorModal.jsx';
import { isSoundEnabled, setSoundEnabled } from '../lib/sounds.js';
import PlanComparison from '../components/PlanComparison.jsx';
import InvoiceList from '../components/InvoiceList.jsx';
import AccountantBooksPicker from '../components/AccountantBooksPicker.jsx';
// Names and addresses are shown tidied rather than stored tidied — an
// accountant's own name is theirs to spell, and rewriting the row would make
// this page the thing that changed it.
import { titleCase, titleCaseLive, lowerEmail } from '../lib/textCase.js';
import { currentPlanType, planLabel as labelForPlan, hasLiveSubscription } from '../lib/plans.js';

// The window a date of birth may fall in — matches the sign-up form, so an
// account cannot be edited into a state it could never have been created in.
function shiftYears(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}
const LATEST_DOB = shiftYears(16);
const EARLIEST_DOB = shiftYears(120);

// A stored number is "+61 412 345 678". The form wants those two parts apart;
// everything else in the app wants them together.
function splitPhone(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\+\d{1,4})\s*(.*)$/);
  if (!match) return { dial: '', number: text };
  return { dial: match[1], number: match[2].trim() };
}

function joinPhone(dial, number) {
  const n = String(number || '').trim();
  if (!n) return '';
  return `${dial || ''} ${n}`.trim();
}
import ChangeEmailSection from '../components/ChangeEmailSection.jsx';
import { useFinancialYears } from '../lib/useFinancialYears.js';
import { financialYearSpan } from '../lib/financialYear.js';
import { formatDateLong, formatDateTime, formatDeadline } from '../lib/dates.js';
import { describeSubscription, toneColor } from '../lib/subscription.js';
import { useConfirm } from '../lib/ConfirmContext.jsx';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

// Matches the sign-up form and the server: capital at the start of each word,
// the rest lower case, applied as they type.
function toPersonName(raw) {
  return String(raw)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function AvatarSection({ user, setUser }) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [editorSrc, setEditorSrc] = useState(null);
  const [editorIsBlobUrl, setEditorIsBlobUrl] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [removeConfirming, setRemoveConfirming] = useState(false);

  function closeEditor() {
    if (editorIsBlobUrl && editorSrc) URL.revokeObjectURL(editorSrc);
    setEditorSrc(null);
    setEditorIsBlobUrl(false);
  }

  function onSelectFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      toast('That image is too large — avatars must be 10MB or smaller.', 'error');
      return;
    }
    setEditorSrc(URL.createObjectURL(file));
    setEditorIsBlobUrl(true);
  }

  function openReposition() {
    if (!user.avatarUrl) return;
    setEditorSrc(user.avatarUrl);
    setEditorIsBlobUrl(false);
  }

  async function onSaveCrop(blob) {
    setAvatarBusy(true);
    setAvatarProgress(0);
    const form = new FormData();
    form.append('avatar', blob, 'avatar.png');
    try {
      const res = await api.post('/auth/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => setAvatarProgress(evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0),
      });
      setUser((u) => (u ? { ...u, avatarUrl: `${res.data.avatarUrl}?t=${Date.now()}` } : u));
      toast('Avatar updated', 'success');
      closeEditor();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAvatarBusy(false);
      setAvatarProgress(0);
    }
  }

  async function onConfirmRemove() {
    setAvatarBusy(true);
    try {
      await api.delete('/auth/avatar');
      setUser((u) => (u ? { ...u, avatarUrl: null } : u));
      toast('Avatar removed', 'success');
      setRemoveConfirming(false);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontWeight: 700 }}>Avatar</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size={72} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
            >
              Upload photo
            </button>
            {user.avatarUrl && (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={openReposition} disabled={avatarBusy}>
                Reposition
              </button>
            )}
            {user.avatarUrl && !removeConfirming && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 13 }}
                onClick={() => setRemoveConfirming(true)}
                disabled={avatarBusy}
              >
                Remove
              </button>
            )}
          </div>
          {removeConfirming && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Remove your avatar?</span>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '4px 10px', background: 'var(--red)' }}
                disabled={avatarBusy}
                onClick={onConfirmRemove}
              >
                {avatarBusy && <span className="spinner" />}
                Confirm
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setRemoveConfirming(false)}
                disabled={avatarBusy}
              >
                Cancel
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onSelectFile} />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Any image, up to 10MB.</span>
        </div>
      </div>

      {editorSrc && (
        <AvatarEditorModal
          imageSrc={editorSrc}
          busy={avatarBusy}
          progress={avatarProgress}
          onCancel={closeEditor}
          onSave={onSaveCrop}
        />
      )}
    </div>
  );
}

function BillingSection({ user }) {
  const confirmRequest = useConfirm();
  const [requesting, setRequesting] = useState(false);
  const [openRequest, setOpenRequest] = useState(null);

  // What has already been asked for, so the cards can say so rather than
  // letting somebody ask twice and receive two invoices.
  useEffect(() => {
    api
      .get('/billing/plan-change-request')
      .then((res) => setOpenRequest(res.data.request))
      .catch(() => setOpenRequest(null));
  }, []);

  // Choosing a plan asks us to move them. Stripe's own switch prorates
  // instantly but only for an account with a live subscription — which
  // excludes anybody on a granted plan, anybody whose subscription lapsed, and
  // any move needing a price the published list cannot express.
  async function requestPlan(plan) {
    if (requesting) return;
    if (openRequest) {
      toast('You already have a plan change waiting — we will be in touch', 'error');
      return;
    }

    const ok = await confirmRequest({
      title: `Ask us to move you to ${plan.name}?`,
      body: (
        <>
          <div style={{ marginBottom: 8 }}>
            We will work out what you owe for the rest of your year and email you an invoice. Nothing is charged until
            you pay it, and your plan stays exactly as it is until then.
          </div>
          <div>This opens a support ticket, so you can follow it and reply to us in one place.</div>
        </>
      ),
      confirmLabel: 'Ask us to move me',
      cancelLabel: 'Not now',
    });
    if (!ok) return;

    setRequesting(true);
    try {
      const res = await api.post('/billing/plan-change-request', { planType: plan.planType });
      setOpenRequest(res.data.request);
      toast('Sent — we will email you an invoice', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRequesting(false);
    }
  }

  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Nothing here goes to Stripe checkout any more — choosing a plan card asks
  // us to invoice instead, which is the one route that works for an account
  // without a live subscription. The old goToCheckout is gone rather than left
  // unused, so nobody wires a button back to it by accident.

  // Checkout for the plan they already have. Nothing about renewing needs a
  // person: same plan, published price, and Stripe already knows how to take
  // the money.
  async function renew() {
    setBusy(true);
    try {
      const res = await api.post('/billing/checkout', { planType: currentPlanType(user) });
      window.location.href = res.data.url;
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  // Acting for clients instead of paying for books of your own.
  //
  // The same route the lapsed screen offers. Somebody who has decided they no
  // longer want their own books is more likely to come looking for it here, in
  // the plan settings, than to wait to be locked out and find it there.
  //
  // Only once the plan has actually ended, matching the rule on every other
  // downgrade: stepping down mid-year would give up time already paid for.
  async function stepDownToAccountant() {
    const ok = await confirm({
      title: 'Use Taxify only to act for clients?',
      body: (
        <>
          <div style={{ marginBottom: 8 }}>
            Your books, expenses and receipts are all kept. They stay read-only while you have no plan, and come
            straight back if you add one later.
          </div>
          <div>You will stop being told your access has ended, and clients can share their books with you as usual.</div>
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

  async function goToPortal() {
    setBusy(true);
    try {
      const res = await api.post('/billing/portal');
      window.location.href = res.data.url;
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  const planLabel = labelForPlan(currentPlanType(user));

  // Read the state through describeSubscription rather than off
  // user.subscriptionStatus. An account an administrator granted free access
  // has no Stripe subscription at all, so its raw status is 'canceled' — which
  // is how this panel came to say "Your access is currently restricted" and
  // offer a Subscribe button to somebody the sidebar was calling Active.
  const status = describeSubscription(user);

  // What the dated lines say, in order of how much the reader cares.
  let detail = status.detail;
  if (status.state === 'trial' && user.trialEndsAt) {
    detail = `Free trial ends ${formatDateLong(user.trialEndsAt)}`;
  } else if (status.state === 'active' && user.subscriptionCurrentPeriodEnd) {
    detail = `Renews ${formatDateLong(user.subscriptionCurrentPeriodEnd)}`;
  } else if (status.state === 'granted') {
    detail = user.accessBypassUntil
      ? `Free access until ${formatDateLong(user.accessBypassUntil)} — nothing to pay`
      : 'Free access — nothing to pay';
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontWeight: 700 }}>Plan &amp; billing</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Plan: <strong style={{ color: 'var(--text)' }}>{planLabel}</strong>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            padding: '3px 9px',
            borderRadius: 999,
            color: toneColor(status.tone),
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: toneColor(status.tone) }} />
          {status.label}
        </span>
      </div>

      {detail && (
        <div style={{ fontSize: 13, color: status.tone === 'bad' ? 'var(--red)' : 'var(--text-muted)' }}>
          {detail}
        </div>
      )}

      {/* Both plans in full, with the current one marked. Prices come from
          Stripe rather than being written here, so what's quoted is what will
          be charged. */}
      {/* Choosing a plan here asks us to move them. Stripe's own switch only
          works for an account with a live subscription, which excludes anybody
          on a granted plan or a lapsed one — so the card raises a request, an
          administrator quotes it, and the plan moves when the invoice is paid. */}
      {/* Paying for the plan they are already on.
          The billing tab could ask us to move them to the other plan and open
          the Stripe portal, and that was all — so somebody whose plan had
          lapsed had no way to simply pay for it again from their own account.
          They had to wait to be redirected to the lapsed-access page to find
          the one button that would have taken their money. */}
      {!hasLiveSubscription(user) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '13px 15px',
            borderRadius: 10,
            border: '1px solid var(--accent)',
            background: 'var(--accent-soft)',
          }}
        >
          <Icon name="repeat" size={17} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5, display: 'block' }}>
              Carry on with {labelForPlan(user?.planType)}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Your books, receipts and every year you have filed pick up exactly where you left them.
            </span>
          </span>
          <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy} onClick={renew}>
            {busy && <span className="spinner" />}
            Renew my plan
          </button>
        </div>
      )}

      <PlanComparison user={user} onChoose={requestPlan} chooseLabel="Ask to move to" refreshKey={openRequest?.id || 0} />

      {openRequest && openRequest.status !== 'cancelled' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${openRequest.status === 'invoiced' ? 'var(--emerald)' : 'var(--accent)'}`,
            borderRadius: 10,
            padding: 14,
            background: 'var(--bg-subtle)',
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          {openRequest.status === 'invoiced' ? (
            <>
              Your invoice for <strong>{labelForPlan(openRequest.toPlan)}</strong> is ready.{' '}
              {openRequest.invoiceUrl && (
                <a href={openRequest.invoiceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  Pay it here
                </a>
              )}{' '}
              — your plan moves across as soon as the payment clears.
            </>
          ) : (
            <>
              We have your request to move to <strong>{labelForPlan(openRequest.toPlan)}</strong> and will email you an
              invoice. It is on your support tickets if you want to add anything.
            </>
          )}
        </div>
      )}

      {/* The way through for anybody Stripe's own switch cannot serve: a
          granted plan, a lapsed one, or a price the published list does not
          carry. */}

      {/* Below the plans, because somebody opens this tab to change plan far
          more often than to find a receipt for last year. */}
      <InvoiceList />

      {/* Only ever the billing portal, and only for somebody who has one.

          The Subscribe button that used to sit here made this page disagree
          with the lapsed-access screen: one offered Stripe checkout, the other
          asked us to invoice. Choosing a plan card now does the same thing on
          both, so a second button offering a different route was the whole
          difference between them.

          A granted account has no Stripe customer, so there is no portal to
          open and offering one leads only to an error. */}
      {user.stripeCustomerId && (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due') && (
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Only once the plan has ended. Before that it would be offering
              somebody the chance to give up time they have paid for. */}
          {user?.accessLocked && user?.role === 'owner' && (
            <button className="btn btn-ghost" onClick={stepDownToAccountant} disabled={busy} style={{ fontSize: 13 }}>
              I only act for clients
            </button>
          )}

          <button className="btn btn-ghost" onClick={goToPortal} disabled={busy} style={{ fontSize: 13 }}>
            {busy && <span className="spinner" />}
            Manage billing
          </button>
        </div>
      )}
    </div>
  );
}

function formatWhen(value) {
  if (!value) return null;
  return formatDateTime(value);
}

// Someone invited only to read other people's books, who wants Taxify for
// their own tax as well. Same login, ordinary account — being an accountant
// was never meant to be an alternative to being a customer.
function StartOwnAccount() {
  const toast = useToast();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const { data } = await api.post('/auth/start-own-account');
      await refresh();
      // A trial is granted once per account. Somebody who has had theirs is
      // told what actually happened rather than promised fourteen days they
      // are not getting.
      toast(
        data?.trialGranted
          ? 'Your own account is ready — your 14-day trial has started'
          : 'Your own account is back. Choose a plan to open your books again.',
        'success'
      );
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name="briefcase" size={18} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700 }}>You're signed in as an accountant</span>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
        Right now this login only opens the books your clients have shared with you. If you want to track your own
        expenses and receipts as well, you can start an ordinary Taxify account on this same login — a 14-day trial,
        the same plans as anyone else, and every client you already have stays exactly as it is.
      </p>
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start', fontSize: 13 }} disabled={busy} onClick={start}>
        {busy && <span className="spinner" />}
        Start tracking my own expenses
      </button>
    </div>
  );
}

// Said the same way in the picker, the summary line and the emails. Kept beside
// the page that shows it; the server has its own copy for the emails, and one
// of them has to be first.
function describeHours(hours) {
  return hours === 24 ? '24 hours' : `${hours / 24} days`;
}

// Changing an existing grant rather than revoking and starting again.
//
// Two things are kept deliberately apart: what they can see, and whether their
// clock is running. Sending one must never quietly change the other — a request
// that only reopens the window leaves the years untouched, because clearing
// them would mean "the whole history".
function ManageAccess({ accountant, years, windowChoices, onDone }) {
  const toast = useToast();
  const [allYears, setAllYears] = useState(!accountant.financialYears);
  const [allBooks, setAllBooks] = useState(!accountant.entityIds);
  const [canWrite, setCanWrite] = useState(Boolean(accountant.canWrite));
  const [pickedBooks, setPickedBooks] = useState(accountant.entityIds || []);
  const [picked, setPicked] = useState(accountant.financialYears || []);
  const [hours, setHours] = useState(accountant.windowHours || 24);
  const [busy, setBusy] = useState(false);

  async function send(body, message) {
    setBusy(true);
    try {
      await api.patch(`/auth/accountant-access/${accountant.id}`, body);
      toast(message, 'success');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const changed =
    allYears !== !accountant.financialYears ||
    hours !== (accountant.windowHours || 24) ||
    (!allYears && picked.join(',') !== (accountant.financialYears || []).join(',')) ||
    canWrite !== Boolean(accountant.canWrite) ||
    allBooks !== !accountant.entityIds ||
    (!allBooks && pickedBooks.join(',') !== (accountant.entityIds || []).join(','));

  const chip = (on) => ({
    fontSize: 12,
    fontWeight: 600,
    padding: '5px 10px',
    borderRadius: 999,
    cursor: 'pointer',
    color: on ? '#fff' : 'var(--text-muted)',
    background: on ? 'var(--accent)' : 'var(--bg-card)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
  });

  return (
    <div
      style={{
        flexBasis: '100%',
        marginTop: 10,
        paddingTop: 12,
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div>
        <div className="label" style={{ margin: '0 0 6px' }}>
          What they can see
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
          <input type="radio" checked={allYears} onChange={() => setAllYears(true)} />
          Every financial year
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
          <input type="radio" checked={!allYears} onChange={() => setAllYears(false)} />
          Only the years I choose
        </label>
        {!allYears && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {years.map((y) => {
              const on = picked.includes(y);
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setPicked((prev) => (on ? prev.filter((v) => v !== y) : [...prev, y]))}
                  style={chip(on)}
                >
                  FY {y}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AccountantBooksPicker
        allBooks={allBooks}
        setAllBooks={setAllBooks}
        picked={pickedBooks}
        setPicked={setPickedBooks}
        chip={chip}
      />

      <div>
        <div className="label" style={{ margin: '0 0 6px' }}>
          What can they do?
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' }}>
          <input type="radio" checked={!canWrite} onChange={() => setCanWrite(false)} style={{ marginTop: 3 }} />
          <span>
            <strong>Read only</strong>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
              They can read and export. Nothing they do can change your records.
            </span>
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer', marginTop: 6 }}>
          <input type="radio" checked={canWrite} onChange={() => setCanWrite(true)} style={{ marginTop: 3 }} />
          <span>
            <strong>Can make changes</strong>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
              They can add, edit, move and delete expenses and receipts in the books you shared. They can never
              delete a set of books, change your plan, or touch your account.
            </span>
          </span>
        </label>
      </div>

      <div>
        <div className="label" style={{ margin: '0 0 6px' }}>
          How long they get
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {windowChoices.map((h) => (
            <button key={h} type="button" onClick={() => setHours(h)} style={chip(hours === h)}>
              {describeHours(h)}
            </button>
          ))}
        </div>

        {/* The date the chosen window actually lands on. "48 hours" is a length,
            not a deadline, and working out which day that is from a number of
            hours is exactly the sum somebody should not have to do. */}
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 7, lineHeight: 1.5 }}>
          {accountant.expiresAt && hours === (accountant.windowHours || 24) ? (
            <>
              Access ends <strong style={{ color: 'var(--text)' }}>{formatDeadline(accountant.expiresAt)}</strong>
            </>
          ) : accountant.firstLoginAt ? (
            <>
              A fresh window would end{' '}
              <strong style={{ color: 'var(--text)' }}>{formatDeadline(deadlineFromNow(hours))}</strong>, starting the
              next time they open your books.
            </>
          ) : (
            <>
              They have not opened your books yet. Whenever they do, access will run until{' '}
              <strong style={{ color: 'var(--text)' }}>{describeHours(hours)}</strong> after that moment.
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12.5, padding: '6px 12px' }}
          disabled={busy || !changed || (!allYears && picked.length === 0) || (!allBooks && pickedBooks.length === 0)}
          onClick={() =>
            send(
              {
                windowHours: hours,
                ...(allYears ? { allYears: true } : { financialYears: picked }),
                ...(allBooks ? { allBooks: true } : { entityIds: pickedBooks }),
                accessLevel: canWrite ? 'write' : 'read',
              },
              'Access updated'
            )
          }
        >
          Save changes
        </button>
        {accountant.firstLoginAt && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12.5, padding: '6px 12px' }}
            disabled={busy}
            onClick={() => send({ reopen: true }, 'They have a fresh window')}
          >
            Give them another {describeHours(accountant.windowHours || 24)}
          </button>
        )}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
        Narrowing what they can see takes effect immediately — they do not need to sign out. A fresh window starts the
        next time they open your books, not now.
      </p>
    </div>
  );
}

// A fixed-height line under a field, so the form does not jump by 15px every
// time a message appears or clears while somebody is typing.
function FieldNote({ problem }) {
  return <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 4, color: 'var(--red)' }}>{problem || ''}</div>;
}

// Where a window of this many hours would land if it started now. Used only
// to show the date beside the choice — the server sets the real one when they
// first open the books.
function deadlineFromNow(hours) {
  return new Date(Date.now() + Number(hours || 24) * 60 * 60 * 1000);
}

// Five minutes, the same figure the server refuses inside.
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

// Resend, with the wait shown rather than left to be discovered.
//
// It was a plain button that worked once and then returned a red toast for
// five minutes. The rate limit was never the surprise — not being told about
// it was.
function ResendButton({ invite, resentAt, onResend }) {
  // The later of the two: what this browser knows it just did, and what the
  // server last recorded. A page reloaded mid-wait has only the second.
  const sentAt = Math.max(resentAt || 0, invite.lastSentAt ? new Date(invite.lastSentAt).getTime() : 0);
  const [now, setNow] = useState(Date.now());
  const left = Math.max(0, sentAt + RESEND_COOLDOWN_MS - now);

  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [left <= 0]);

  const seconds = Math.ceil(left / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: 12, padding: '5px 11px', fontVariantNumeric: 'tabular-nums' }}
      disabled={left > 0}
      title={left > 0 ? 'Sent a moment ago — one every five minutes' : 'Send the invitation again'}
      onClick={() => onResend(invite)}
    >
      {left > 0 ? `Resend in ${mm}:${ss}` : 'Resend'}
    </button>
  );
}

function AccountantSection({ user }) {
  const confirm = useConfirm();
  const toast = useToast();
  // Only the years the *chosen* books actually have.
  //
  // Asked in that order for a reason: which years exist depends on which books
  // are being shared, so choosing years first means choosing from a list that
  // is about to change. A year with nothing in the shared books is an empty
  // folder, and offering it makes the choice look meaningful when it grants
  // nothing.
  const [accountants, setAccountants] = useState(null);
  const [windowHours, setWindowHours] = useState(24);
  const [windowChoices, setWindowChoices] = useState([24, 48, 72, 96]);
  // How long the invite being written now should last once opened.
  const [inviteWindow, setInviteWindow] = useState(24);
  // Which existing grant has its panel open, and what is being changed in it.
  const [managing, setManaging] = useState(null);
  // Invitations nobody has accepted yet. Kept apart from the granted list
  // because they are a different thing: a promise, not access.
  const [invites, setInvites] = useState([]);
  // When this browser last pressed Resend, per invitation. Held here rather
  // than read back from the list, so the button locks on the press instead of
  // waiting for the refetch.
  const [resentAt, setResentAt] = useState({});
  const [inviteEmail, setInviteEmail] = useState('');
  // What we know about that address: idle, checking, known, unknown, self.
  // Everything below the field turns on it, so the form can say what pressing
  // the button will do rather than finding out afterwards.
  const [lookup, setLookup] = useState({ state: 'idle', name: null });

  const [allYears, setAllYears] = useState(true);
  const [allBooks, setAllBooks] = useState(true);
  const [inviteCanWrite, setInviteCanWrite] = useState(false);
  const [pickedBooks, setPickedBooks] = useState([]);

  // Below the state it reads, not above it.
  //
  // This sat further up the component, where `allBooks` and `pickedBooks` had
  // not been declared yet — a const in its temporal dead zone, which throws
  // "Cannot access before initialization" the moment the tab renders. It read
  // fine and crashed the page.
  //
  // Only the years the *chosen* books actually have. Which years exist depends
  // on which books are shared, so a year with nothing in them is an empty
  // folder, and offering it makes the choice look meaningful when it grants
  // nothing.
  const { years: grantableYears } = useFinancialYears({
    entityIds: allBooks ? null : pickedBooks,
  });
  const [pickedYears, setPickedYears] = useState([]);
  const [busy, setBusy] = useState(false);

  function load() {

    api.get('/auth/accountant-access').then((res) => {
      setAccountants(res.data.accountants);
      setWindowHours(res.data.windowHours || 24);
      if (res.data.windowChoices?.length) setWindowChoices(res.data.windowChoices);
      setInvites(res.data.invites || []);
    });
  }

  useEffect(load, []);



  async function onInvite(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/auth/invite', {
        email: inviteEmail.trim().toLowerCase(),
        role: 'accountant',
        // Omitted entirely for a family member — the server ignores it, and
        // sending it anyway would suggest it did something.
        //
        // For an accountant the intent is stated rather than inferred: either
        // allYears, or a list. The server refuses a list where nothing is a
        // real year instead of reading it as "everything", which is what an
        // omitted field used to mean.
        ...(true
          ? {
              windowHours: inviteWindow,
              ...(allYears ? { allYears: true } : { financialYears: pickedYears }),
              ...(allBooks ? { allBooks: true } : { entityIds: pickedBooks }),
              accessLevel: inviteCanWrite ? 'write' : 'read',
            }
          : {}),
      });
      // Two quite different things can have happened, and the difference
      // decides what this person does next — wait, or go and tell their
      // accountant to sign up. One word ("Sent") for both would leave somebody
      // waiting for an acceptance that cannot come.
      if (data?.outcome === 'not_registered') {
        await confirm({
          title: 'They do not have a Taxify account yet',
          body: (
            <>
              <div style={{ marginBottom: 8 }}>
                Nothing has been shared. We have emailed {inviteEmail.trim().toLowerCase()} to explain that you would
                like to share your books with them, and how to create an account.
              </div>
              <div>
                Access can only be given to an address somebody has claimed and confirmed. Once they tell you their
                account is set up, enter their email here again and they will get an invitation to accept.
              </div>
            </>
          ),
          confirmLabel: 'I understand',
          // Both buttons close it. This is a result being reported, not a
          // decision being asked for — but it is too long to be a toast and
          // too important to be missed.
          cancelLabel: 'Close',
        });
      } else {
        toast('Invitation sent — they will get an email to accept it', 'success');
      }
      setInviteEmail('');
      setPickedYears([]);
      setAllYears(true);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onResendInvite(invite) {
    // Locked here, before the request goes out. The countdown is worked out
    // from lastSentAt on the row, and the row is only refetched once load()
    // comes back — so between the press and the reply the button sat enabled
    // and could be pressed again, and the second press earned a red toast for
    // the server's rate limit through no fault of the person pressing it.
    setResentAt((prev) => ({ ...prev, [invite.id]: Date.now() }));
    try {
      const { data } = await api.post(`/auth/accountant-invites/${invite.id}/resend`);
      toast(data.emailed ? 'Invitation sent again' : 'Saved, but the email would not send', data.emailed ? 'success' : 'error');
      load();
    } catch (err) {
      // The server says how long is left when it refuses. Trusted over our own
      // clock, which is the one that was wrong if we got here at all.
      if (err.retryAfterSeconds) {
        setResentAt((prev) => ({
          ...prev,
          [invite.id]: Date.now() - (RESEND_COOLDOWN_MS - err.retryAfterSeconds * 1000),
        }));
      } else {
        // Nothing to do with the wait — unlock, or they are stuck for five
        // minutes over an error that would clear on a second press.
        setResentAt((prev) => {
          const next = { ...prev };
          delete next[invite.id];
          return next;
        });
      }
      toast(err.message, 'error');
    }
  }

  async function onCancelInvite(invite) {
    if (!(await confirm({ title: `Cancel the invitation to ${invite.email}?`, body: 'The link in their email stops working immediately.', confirmLabel: 'Cancel invitation', cancelLabel: 'Keep it' }))) return;
    try {
      await api.delete(`/auth/accountant-invites/${invite.id}`);
      toast('Invitation cancelled', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function onRevokeAccountant(assignment) {
    if (!(await confirm({ title: `Remove ${assignment.name}’s access?`, body: 'They lose sight of your books straight away.', confirmLabel: 'Remove access' }))) return;
    try {
      await api.delete(`/auth/accountant-access/${assignment.id}`);
      toast('Accountant access removed', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // A shape check, not a promise the address exists — that is what sending to
  // it proves. It only has to stop the obvious: a missing @, a missing dot, a
  // stray space.
  const emailLooksReal = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(inviteEmail.trim());

  // Debounced, and only once the address could be one. Asking after every
  // keystroke would be a request per letter, for an answer that cannot be
  // right until the whole address is there.
  useEffect(() => {
    if (!emailLooksReal) {
      setLookup({ state: 'idle', name: null });
      return undefined;
    }
    setLookup((prev) => ({ ...prev, state: 'checking' }));
    let alive = true;
    const timer = setTimeout(() => {
      api
        .get(`/auth/accountant-lookup?email=${encodeURIComponent(inviteEmail.trim())}`)
        .then((res) => {
          if (!alive) return;
          if (res.data.self) return setLookup({ state: 'self', name: null });
          setLookup({ state: res.data.known ? 'known' : 'unknown', name: res.data.name || null });
        })
        // Rate limited, or offline. Treated as unknown rather than blocking the
        // form — the server checks again on submit and is the authority either
        // way.
        .catch(() => alive && setLookup({ state: 'unknown', name: null }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [inviteEmail, emailLooksReal]);

  // One accountant at a time. Two people holding read-only access to somebody
  // else's tax records is twice the exposure for no benefit, and an invitation
  // already waiting is the same commitment as a granted one.
  const alreadyShared = (accountants?.length || 0) > 0 || invites.length > 0;


  // An address that looks like one, and a choice of years and books. The name
  // and firm are no longer asked for, so they no longer gate the button.
  // Only for somebody who can actually receive it. An address with no account
  // has its own button, which sends the sign-up email instead.
  const canSubmit =
    lookup.state === 'known' && (allYears || pickedYears.length > 0) && (allBooks || pickedBooks.length > 0);

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontWeight: 700 }}>Accountant access</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.55 }}>
          A read-only look at the years you choose, for as long as you choose, ending on its own.
        </div>
      </div>

      {/* Invitations count towards this too. Otherwise an account with one out
          and nobody accepted yet shows nothing at all — which is precisely the
          state somebody most wants to look at. */}
      {(accountants?.length > 0 || invites.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Accountants
          </div>
          {invites.map((i) => (
            <div
              key={`invite-${i.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                borderLeft: '3px solid var(--amber)',
              }}
            >
              <Icon name="mail" size={16} style={{ color: 'var(--amber)' }} />
              <span style={{ minWidth: 140, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{i.name ? titleCase(i.name) : lowerEmail(i.email)}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {i.name ? `${lowerEmail(i.email)} · ` : ''}Invited, waiting for them to accept
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {i.financialYears ? `FY ${i.financialYears.join(', ')}` : 'All years'}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>Link expires {formatWhen(i.expiresAt)}</span>
              <ResendButton invite={i} resentAt={resentAt[i.id]} onResend={onResendInvite} />
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 11px' }}
                onClick={() => onCancelInvite(i)}
              >
                Cancel
              </button>
            </div>
          ))}

          {accountants.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
              }}
            >
              <Icon name="briefcase" size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ minWidth: 140, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{titleCase(a.practiceName || a.name)}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {a.practiceName ? `${titleCase(a.name)} · ` : ''}
                  {lowerEmail(a.email)}
                  {a.phone ? ` · ${a.phone}` : ''}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {a.financialYears ? `FY ${a.financialYears.join(', ')}` : 'All years'}
              </span>
              {/* expires_at is only set once they first open the books, so an
                  empty one means "not started", never "expired". Until then
                  there is no cut-off to show — only how long it will run for
                  once the clock starts. */}
              <span style={{ fontSize: 11.5, color: a.expiresAt ? 'var(--amber)' : 'var(--text-muted)' }}>
                {a.expiresAt
                  ? `Ends ${formatDeadline(a.expiresAt)}`
                  : `Not opened yet — ${describeHours(a.windowHours || 24)} once they do`}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 11px' }}
                onClick={() => setManaging(managing?.id === a.id ? null : { ...a })}
              >
                {managing?.id === a.id ? 'Close' : 'Manage'}
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 11px' }}
                onClick={() => onRevokeAccountant(a)}
              >
                Revoke
              </button>

              {managing?.id === a.id && (
                <ManageAccess
                  accountant={a}
                  years={grantableYears}
                  windowChoices={windowChoices}
                  onDone={() => {
                    setManaging(null);
                    load();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {user?.accessLocked ? (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '11px 13px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--red)',
            background: 'var(--bg-subtle)',
          }}
        >
          <Icon name="lock" size={15} style={{ color: 'var(--red)', marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-muted)' }}>
            Your plan has ended, so your books are shut to you as well — there is nothing to share yet. Start a plan
            and you can invite your accountant straight away.
            {(accountants?.length > 0 || invites.length > 0) &&
              ' Anyone already on the list cannot open your books while it is ended either.'}
          </span>
        </div>
      ) : alreadyShared ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Access is given to one accountant at a time. Remove the access above to invite somebody else.
        </p>
      ) : (
      <form onSubmit={onInvite} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            Your accountant's email address
          </label>
          <input
            className="input"
            required
            type="email"
            autoComplete="off"
            placeholder="them@theirfirm.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value.toLowerCase())}
          />

          {/* What is about to happen, before the button is pressed.
              The form asks for an address and nothing else, so it has to say
              which of two quite different things a press will do: invite
              somebody who can accept, or write to a stranger asking them to
              sign up first. */}
          <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>
            {lookup.state === 'checking' && <span style={{ color: 'var(--text-muted)' }}>Checking…</span>}

            {lookup.state === 'self' && (
              <span style={{ color: 'var(--red)' }}>That is your own address.</span>
            )}

            {lookup.state === 'known' && (
              <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>
                <Icon name="check-circle" size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                Account found{lookup.name ? ` — ${lookup.name}` : ''}. Choose what they can see below.
              </span>
            )}

            {lookup.state === 'unknown' && (
              <span style={{ color: 'var(--text-muted)' }}>
                No Taxify account at that address, so there is nobody to give access to yet.
              </span>
            )}
          </div>
        </div>

        {/* Nothing to grant, so the only useful action is asking them to sign
            up. Said as its own step rather than letting somebody fill in books
            and years for a person who cannot receive them. */}
        {lookup.state === 'unknown' && (
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--accent)',
              background: 'var(--bg-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-muted)' }}>
              Access can only be given to somebody with their own Taxify account, confirmed at that address — it is
              how we know the person reading your records is the person you meant. We can email them and explain how
              to set one up. Nothing is shared, and you enter their address again once they tell you it is done.
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start', fontSize: 13 }}
              disabled={busy}
              onClick={onInvite}
            >
              {busy && <span className="spinner" />}
              Email them about creating an account
            </button>
          </div>
        )}

        {lookup.state === 'known' && (
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-inset)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Only appears when there is more than one set of books — with
                one, "all of them" and "that one" are the same grant. */}
            <AccountantBooksPicker
              allBooks={allBooks}
              setAllBooks={setAllBooks}
              picked={pickedBooks}
              setPicked={setPickedBooks}
              chip={(on) => ({
                fontSize: 12,
                padding: '6px 11px',
                borderRadius: 999,
                cursor: 'pointer',
                color: on ? '#fff' : 'var(--text-muted)',
                background: on ? 'var(--accent)' : 'var(--bg-card)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              })}
            />

            <div className="label" style={{ margin: 0 }}>
              How much of your history can they see?
            </div>
            {!allBooks && pickedBooks.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -4, lineHeight: 1.5 }}>
                Only the years the books you chose have anything in.
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={allYears} onChange={() => setAllYears(true)} />
              Every financial year
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={!allYears} onChange={() => setAllYears(false)} />
              Only the years I choose
            </label>

            {!allYears && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 2 }}>
                {grantableYears.map((y) => {
                  const on = pickedYears.includes(y);
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setPickedYears((prev) => (on ? prev.filter((p) => p !== y) : [...prev, y]))}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '6px 11px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        color: on ? '#fff' : 'var(--text-muted)',
                        background: on ? 'var(--accent)' : 'var(--bg-card)',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      FY {y}
                    </button>
                  );
                })}
              </div>
            )}

            <div>
              <div className="label" style={{ margin: '0 0 6px' }}>
                What can they do?
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" checked={!inviteCanWrite} onChange={() => setInviteCanWrite(false)} style={{ marginTop: 3 }} />
                <span>
                  <strong>Read only</strong>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
                    They can read and export. Nothing they do can change your records.
                  </span>
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer', marginTop: 6 }}>
                <input type="radio" checked={inviteCanWrite} onChange={() => setInviteCanWrite(true)} style={{ marginTop: 3 }} />
                <span>
                  <strong>Can make changes</strong>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
                    They can add, edit, move and delete expenses and receipts in the books you shared. They can never
                    delete a set of books, change your plan, or touch your account.
                  </span>
                </span>
              </label>
            </div>

            <div className="label" style={{ margin: '4px 0 0' }}>
              How long do they get?
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {windowChoices.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setInviteWindow(h)}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    color: inviteWindow === h ? '#fff' : 'var(--text-muted)',
                    background: inviteWindow === h ? 'var(--accent)' : 'var(--bg-card)',
                    border: `1px solid ${inviteWindow === h ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {describeHours(h)}
                </button>
              ))}
            </div>

            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              The clock starts the first time they open your books, not now — so a Friday invitation is still good on
              Monday. After {describeHours(inviteWindow)} the access is removed automatically. They can never change
              anything.
            </p>
          </div>
        )}

        {/* Only once there is somebody to invite. Before that the useful
            button is the other one — leaving a dead "Invite accountant" beside
            "Email them about creating an account" is two buttons where one of
            them cannot work, and no way to tell which from looking. */}
        {lookup.state === 'known' && (
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !canSubmit}
            style={{ alignSelf: 'flex-start', fontSize: 13 }}
          >
            {busy && <span className="spinner" />}
            Invite {lookup.name || 'them'}
          </button>
        )}
      </form>
      )}

    </div>
  );
}

export default function Account() {
  const { user, updateProfile, changePassword, setOtpEnabled, setUser, refresh } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Back from Stripe, having paid.
  //
  // Everything about a subscription used to reach us by webhook, and a webhook
  // is a promise from another machine. Delayed, mis-configured, or an event
  // never switched on in the dashboard, and somebody pays to renew, is sent
  // back here, and finds themselves still locked out holding a receipt. From
  // their side that is indistinguishable from being robbed, and it is the
  // worst thing this app can do.
  //
  // They are standing right here when they come back, so we ask Stripe rather
  // than wait to be told. The webhook still runs and still wins ties — this is
  // a second route to the same truth, not a replacement for it.
  useEffect(() => {
    if (searchParams.get('checkout') !== 'success') return;

    let alive = true;
    (async () => {
      try {
        await api.post('/billing/sync');
        if (!alive) return;
        await refresh();
        toast('Thank you — your account is active again', 'success');
      } catch {
        // The payment went through either way; the webhook will catch up. Not
        // worth alarming somebody who has just paid.
        await refresh().catch(() => {});
      } finally {
        if (alive) {
          // Cleared so a refresh does not run it again, and so the URL stops
          // saying something that is no longer news.
          const next = new URLSearchParams(searchParams);
          next.delete('checkout');
          setSearchParams(next, { replace: true });
        }
      }
    })();

    return () => {
      alive = false;
    };
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything captured at sign-up is editable here except how they heard
  // about us — that's a one-time answer about a moment that's passed.
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth || '');
  const [phone, setPhone] = useState(() => splitPhone(user.phone).number);
  const [dialCode, setDialCode] = useState(() => splitPhone(user.phone).dial);
  const [currency, setCurrency] = useState(user.currency || 'AUD');
  const [practiceName, setPracticeName] = useState(user.practiceName || '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [options, setOptions] = useState(null);

  // One entry per code, not per country, sorted by the number rather than as
  // text — +1, +20, +7 in string order is nobody's idea of a list.
  const dialOptions = useMemo(() => {
    const seen = new Map();
    for (const c of options?.countries || []) {
      if (c.dial && !seen.has(c.dial)) seen.set(c.dial, { dial: c.dial, code: c.code });
    }
    return [...seen.values()].sort((a, b) => Number(a.dial.slice(1)) - Number(b.dial.slice(1)));
  }, [options]);

  // Only when the account has no number at all — an existing one already
  // carries its own code and must not be moved to another country's.
  useEffect(() => {
    if (dialCode || dialOptions.length === 0) return;
    const fromCountry = options?.countries?.find((c) => c.name === user.country)?.dial;
    setDialCode(fromCountry || dialOptions[0].dial);
  }, [dialOptions, dialCode, options, user.country]);

  // Same lists the sign-up form uses, so the two can't drift.
  useEffect(() => {
    api
      .get('/auth/signup-options')
      .then((res) => setOptions(res.data))
      .catch(() => setOptions({ countries: [], states: {}, currencies: [] }));
  }, []);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [mfaBusy, setMfaBusy] = useState(false);

  // Device-local, so it isn't sent to the server or shared between machines.
  const [soundOn, setSoundOn] = useState(isSoundEnabled);

  function onToggleSound(next) {
    setSoundEnabled(next);
    setSoundOn(next);
  }

  async function toggleMfa(enabled) {
    setMfaBusy(true);
    try {
      await setOtpEnabled(enabled);
      toast(enabled ? 'MFA is now on' : 'MFA is now off', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMfaBusy(false);
    }
  }

  const profileChanged =
    firstName.trim() !== (user.firstName || '') ||
    lastName.trim() !== (user.lastName || '') ||
    dateOfBirth !== (user.dateOfBirth || '') ||
    joinPhone(dialCode, phone) !== (user.phone || '') ||
    currency !== (user.currency || '') ||
    practiceName.trim() !== (user.practiceName || '');

  async function onSaveProfile(e) {
    e.preventDefault();
    setProfileBusy(true);
    try {
      await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth,
        phone: joinPhone(dialCode, phone),
        currency,
        practiceName: practiceName.trim(),
      });
      toast('Account details updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setProfileBusy(false);
    }
  }

  async function onSavePassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast('New passwords do not match', 'error');
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast('Password updated', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPasswordBusy(false);
    }
  }

  // One page of eight stacked cards means scrolling past billing to change a
  // password. The tabs are the same sections, one area at a time, and the tab
  // lives in the URL so "go to billing" can link straight to it.
  const tabs = [
    { id: 'profile', label: 'Profile', icon: 'user' },
    ...(user.role === 'owner'
      ? [
          { id: 'billing', label: 'Plan & billing', icon: 'credit-card' },
          { id: 'family', label: 'Accountant access', icon: 'briefcase' },
        ]
      : []),
    { id: 'security', label: 'Email & password', icon: 'shield' },
    { id: 'preferences', label: 'Preferences', icon: 'settings' },
  ];

  const requested = searchParams.get('tab');
  const tab = tabs.some((t) => t.id === requested) ? requested : 'profile';
  const active = tabs.find((t) => t.id === tab);

  function selectTab(id) {
    setSearchParams(id === 'profile' ? {} : { tab: id }, { replace: true });
  }

  return (
    <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Account settings</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Update your details, password, and how you sign in.</p>
      </div>

      <div
        role="tablist"
        className="account-tabs scrollbar-slim"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: 4,
          borderRadius: 'var(--radius)',
          background: 'var(--bg-inset)',
          border: '1px solid var(--border)',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => selectTab(t.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '8px 13px',
              borderRadius: 8,
              border: 0,
              cursor: 'pointer',
              fontSize: 13,
              whiteSpace: 'nowrap',
              fontWeight: 600,
              color: t.id === tab ? 'var(--text)' : 'var(--text-muted)',
              background: t.id === tab ? 'var(--bg-elevated)' : 'transparent',
              boxShadow: t.id === tab ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        {tab === 'profile' && user.role === 'accountant' && <StartOwnAccount />}
        {tab === 'profile' && <AvatarSection user={user} setUser={setUser} />}

        {tab === 'billing' && <BillingSection user={user} />}
        {tab === 'family' && <AccountantSection user={user} />}

      <form
        onSubmit={onSaveProfile}
        className="card"
        style={{ padding: 20, display: tab === 'profile' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ fontWeight: 700 }}>Profile</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">First name</label>
            <input
              className="input"
              required
              maxLength={60}
              value={firstName}
              onChange={(e) => setFirstName(toPersonName(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Last name</label>
            <input
              className="input"
              required
              maxLength={60}
              value={lastName}
              onChange={(e) => setLastName(toPersonName(e.target.value))}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Date of birth</label>
            <input
              className="input"
              type="date"
              max={LATEST_DOB}
              min={EARLIEST_DOB}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>You need to be 16 or over</div>
          </div>
          <div>
            <label className="label">Phone number</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                className="input"
                aria-label="Country code"
                value={dialCode}
                onChange={(e) => setDialCode(e.target.value)}
                style={{ width: 104, flexShrink: 0, paddingLeft: 8, paddingRight: 4 }}
              >
                {dialOptions.map((d) => (
                  <option key={d.code} value={d.dial}>
                    {d.dial} {d.code}
                  </option>
                ))}
              </select>
              <input
                className="input"
                inputMode="tel"
                maxLength={20}
                placeholder="412 345 678"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d\s()-]/g, ''))}
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
          </div>
        </div>

        {/* Read-only here on purpose: the sign-in address only moves once the
            new one has been proved, which is what the Email & password tab
            does. Editing it inline would look like it had worked. */}
        <div>
          <label className="label">Email</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input className="input" type="email" value={user.email} readOnly disabled style={{ flex: 1, minWidth: 200 }} />
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12.5, padding: '8px 13px' }}
              onClick={() => selectTab('security')}
            >
              Change email
            </button>
          </div>
        </div>

        {/* Fixed after sign-up. The country decides which twelve months count
            as a financial year, and every expense, receipt folder, category and
            closed year has already been filed under that answer — changing it
            here would silently refile a whole history into years it was never
            claimed in. The server refuses it too. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Country</label>
            <input className="input" value={user.country || '—'} readOnly disabled />
          </div>
          <div>
            <label className="label">State or region</label>
            <input className="input" value={user.state || '—'} readOnly disabled />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: -6 }}>
          <Icon name="lock" size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            Your financial year runs <strong>{financialYearSpan(user.financialYearRule)}</strong>, set from your
            country when you signed up. Country and region are fixed because everything you have recorded is filed
            against them — contact support if they are wrong.
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Preferred currency</label>
            {/* Fixed once the account exists. Every amount already recorded is
                held in this currency, so changing it would not convert
                anything — it would relabel years of figures as a different
                currency and quietly make every total wrong. Shown rather than
                hidden, because it is a fact worth knowing about the account. */}
            <select className="input" value={currency} disabled onChange={(e) => setCurrency(e.target.value)}>
              {(options?.currencies || []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          {/* A different fact from the business name above: that one is the
              business whose expenses you track, this one is the firm you do
              other people's returns under. Somebody can have both, so it is
              shown only to people who actually act for clients. */}
          {(user.isAccountant || user.role === 'accountant') && (
            <div>
              <label className="label">Practice or firm name</label>
              <input
                className="input"
                maxLength={160}
                value={practiceName}
                placeholder="e.g. Chen & Co"
                onChange={(e) => setPracticeName(e.target.value)}
              />
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
                Shown to clients who share their books with you.
              </div>
            </div>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={profileBusy || !profileChanged} style={{ alignSelf: 'flex-start' }}>
          {profileBusy && <span className="spinner" />}
          Save changes
        </button>
      </form>

        {tab === 'security' && user.role === 'owner' && <ChangeEmailSection user={user} />}

      <form
        onSubmit={onSavePassword}
        className="card"
        style={{ padding: 20, display: tab === 'security' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ fontWeight: 700 }}>Change password</div>
        <div>
          <label className="label">Current password</label>
          <input
            className="input"
            required
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">New password</label>
            <input className="input" required type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input
              className="input"
              required
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          At least 8 characters, with an uppercase letter, a lowercase letter, and a number.
        </p>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
          style={{ alignSelf: 'flex-start' }}
        >
          {passwordBusy && <span className="spinner" />}
          Update password
        </button>
      </form>

      {/* Nothing to decide, so nothing is shown.

          Two-factor is required of every account. A panel explaining a setting
          somebody cannot change is a panel that invites them to look for the
          switch, find none, and write in about it. The one thing worth saying
          is said where it matters — at sign-in, when the code arrives. */}

        {tab === 'preferences' && (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 700 }}>Interface sounds</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  Short tones on saving, errors, and opening a dialog. Stored on this device.
                </div>
              </div>
              <Toggle checked={soundOn} onChange={onToggleSound} />
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
