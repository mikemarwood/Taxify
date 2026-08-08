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
import PlanChangeRequest from '../components/PlanChangeRequest.jsx';
// Names and addresses are shown tidied rather than stored tidied — an
// accountant's own name is theirs to spell, and rewriting the row would make
// this page the thing that changed it.
import { titleCase, titleCaseLive, lowerEmail } from '../lib/textCase.js';
import { nameProblem, companyProblem, NAME_MAX, COMPANY_MAX } from '../lib/inviteFields.js';
import { currentPlanType, planLabel as labelForPlan } from '../lib/plans.js';

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
import { formatDateLong, formatDateTime } from '../lib/dates.js';
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
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function goToCheckout() {
    setBusy(true);
    try {
      const res = await api.post('/billing/checkout');
      window.location.href = res.data.url;
    } catch (err) {
      toast(err.message, 'error');
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
      <PlanComparison user={user} />

      {/* The way through for anybody Stripe's own switch cannot serve: a
          granted plan, a lapsed one, or a price the published list does not
          carry. */}
      <PlanChangeRequest user={user} />

      {/* Below the plans, because somebody opens this tab to change plan far
          more often than to find a receipt for last year. */}
      <InvoiceList />

      {/* A granted account has no Stripe customer, so there is neither anything
          to buy nor a portal to open — offering either only leads to an error. */}
      {status.state !== 'granted' && (
        <div style={{ display: 'flex', gap: 10 }}>
          {user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due' ? (
            <button className="btn btn-ghost" onClick={goToPortal} disabled={busy} style={{ fontSize: 13 }}>
              {busy && <span className="spinner" />}
              Manage billing
            </button>
          ) : (
            <button className="btn btn-primary" onClick={goToCheckout} disabled={busy} style={{ fontSize: 13 }}>
              {busy && <span className="spinner" />}
              Subscribe to {planLabel}
            </button>
          )}
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
      await api.post('/auth/start-own-account');
      await refresh();
      toast('Your own account is ready — your 14-day trial has started', 'success');
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
    (!allYears && picked.join(',') !== (accountant.financialYears || []).join(','));

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
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12.5, padding: '6px 12px' }}
          disabled={busy || !changed || (!allYears && picked.length === 0)}
          onClick={() =>
            send(
              { windowHours: hours, ...(allYears ? { allYears: true } : { financialYears: picked }) },
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

function AccountantSection({ user }) {
  const confirm = useConfirm();
  const toast = useToast();
  // Only the years this account actually has — offering an accountant a year
  // with nothing in it is offering them nothing.
  const { years: grantableYears } = useFinancialYears();

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
  const [inviteFirst, setInviteFirst] = useState('');
  const [inviteLast, setInviteLast] = useState('');
  const [inviteCompany, setInviteCompany] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  const [allYears, setAllYears] = useState(true);
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
      await api.post('/auth/invite', {
        firstName: inviteFirst.trim(),
        lastName: inviteLast.trim(),
        companyName: inviteCompany.trim() || null,
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
          ? { windowHours: inviteWindow, ...(allYears ? { allYears: true } : { financialYears: pickedYears }) }
          : {}),
      });
      toast('Invitation sent', 'success');
      setInviteFirst('');
    setInviteLast('');
    setInviteCompany('');
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
    try {
      const { data } = await api.post(`/auth/accountant-invites/${invite.id}/resend`);
      toast(data.emailed ? 'Invitation sent again' : 'Saved, but the email would not send', data.emailed ? 'success' : 'error');
      load();
    } catch (err) {
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

  // One accountant at a time. Two people holding read-only access to somebody
  // else's tax records is twice the exposure for no benefit, and an invitation
  // already waiting is the same commitment as a granted one.
  const alreadyShared = (accountants?.length || 0) > 0 || invites.length > 0;

  const firstProblem = inviteFirst.trim() ? nameProblem(inviteFirst, 'First name') : '';
  const lastProblem = inviteLast.trim() ? nameProblem(inviteLast, 'Last name') : '';
  const companyIssue = companyProblem(inviteCompany);

  const canSubmit =
    !nameProblem(inviteFirst, 'First name') &&
    !nameProblem(inviteLast, 'Last name') &&
    !companyIssue &&
    emailLooksReal &&
    (allYears || pickedYears.length > 0);

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
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 11px' }}
                onClick={() => onResendInvite(i)}
              >
                Resend
              </button>
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
              <span style={{ fontSize: 11.5, color: a.expiresAt ? 'var(--amber)' : 'var(--text-muted)' }}>
                {a.expiresAt ? `Ends ${formatWhen(a.expiresAt)}` : 'Not opened yet'}
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

      {alreadyShared ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Access is given to one accountant at a time. Remove the access above to invite somebody else.
        </p>
      ) : (
      <form onSubmit={onInvite} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* titleCaseLive while typing and titleCase on blur, the same as the
            book name: titleCase trims, so running it on every keystroke eats
            the space before a second word can be started. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <input
              className="input"
              required
              maxLength={NAME_MAX}
              placeholder="First name"
              autoComplete="off"
              value={inviteFirst}
              onChange={(e) => setInviteFirst(titleCaseLive(e.target.value))}
              onBlur={() => setInviteFirst(titleCase(inviteFirst))}
              aria-invalid={firstProblem ? 'true' : undefined}
              style={firstProblem ? { borderColor: 'var(--red)' } : undefined}
            />
            <FieldNote problem={firstProblem} />
          </div>
          <div>
            <input
              className="input"
              required
              maxLength={NAME_MAX}
              placeholder="Last name"
              autoComplete="off"
              value={inviteLast}
              onChange={(e) => setInviteLast(titleCaseLive(e.target.value))}
              onBlur={() => setInviteLast(titleCase(inviteLast))}
              aria-invalid={lastProblem ? 'true' : undefined}
              style={lastProblem ? { borderColor: 'var(--red)' } : undefined}
            />
            <FieldNote problem={lastProblem} />
          </div>
        </div>

        <div>
          <input
            className="input"
            maxLength={COMPANY_MAX}
            placeholder="Practice or firm name (optional)"
            autoComplete="off"
            value={inviteCompany}
            onChange={(e) => setInviteCompany(titleCaseLive(e.target.value))}
            onBlur={() => setInviteCompany(titleCase(inviteCompany))}
            aria-invalid={companyIssue ? 'true' : undefined}
            style={companyIssue ? { borderColor: 'var(--red)' } : undefined}
          />
          <FieldNote problem={companyIssue} />
        </div>

        <input
          className="input"
          required
          type="email"
          placeholder="Email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value.toLowerCase())}
        />

        {true && (
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
            <div className="label" style={{ margin: 0 }}>
              How much of your history can they see?
            </div>
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

        <button className="btn btn-primary" type="submit" disabled={busy || !canSubmit} style={{ alignSelf: 'flex-start', fontSize: 13 }}>
          {busy && <span className="spinner" />}
          Invite accountant
        </button>
      </form>
      )}

    </div>
  );
}

export default function Account() {
  const { user, updateProfile, changePassword, setOtpEnabled, setUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

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
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
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

      <div className="card" style={{ padding: 20, display: tab === 'security' ? 'block' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Multi-Factor Authentication (MFA)</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {user.mfaMode === 'required'
                ? 'Required — a code is emailed to you at every login.'
                : user.otpEnabled
                ? 'On — a code is emailed to you at every login.'
                : 'Off — turn it on for an extra layer of protection.'}
            </div>
          </div>
          {user.mfaMode === 'optional' && (
            <Toggle checked={user.otpEnabled} disabled={mfaBusy} onChange={toggleMfa} />
          )}
        </div>
        <OtpBenefits />
      </div>

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
