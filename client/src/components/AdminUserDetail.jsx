import { useEffect, useState } from 'react';
import { useLockBodyScroll } from '../lib/useLockBodyScroll.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import { AnimatePresence, motion } from 'framer-motion';
import Toggle from './Toggle.jsx';
import { api } from '../lib/api.js';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { formatMoney } from '../lib/money.js';
import { formatDateShort, formatDateTime } from '../lib/dates.js';
import { planLabel } from '../lib/plans.js';

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// "in 12 days", "today", "9 days ago" — the thing somebody is working out in
// their head while looking at a date, done for them.
// Whether a trial date has already passed.
//
// Worth its own name: subscription_status stays 'trialing' after the date
// goes by, because nothing rewrites it on the way through. The date is the
// only thing that knows.
// The status in words, and coloured by what it means.
//
// The column stores pending | invoiced | paid | cancelled, which are fine as
// data and poor as a sentence — 'pending' beside a request answered months
// ago reads as still waiting.
const PLAN_STATUS = {
  pending: 'awaiting an invoice',
  invoiced: 'invoice sent',
  paid: 'paid',
  cancelled: 'cancelled',
};

function planStatusLabel(status) {
  return PLAN_STATUS[status] || status;
}

function planStatusTone(status) {
  if (status === 'paid') return 'var(--emerald)';
  if (status === 'cancelled') return 'var(--text-muted)';
  return 'var(--accent)';
}

function trialOver(value) {
  return Boolean(value) && new Date(value).getTime() < Date.now();
}

function daysAway(value) {
  if (!value) return '';
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days === 0) return '(today)';
  return days > 0 ? `(in ${days} day${days === 1 ? '' : 's'})` : `(${-days} day${days === -1 ? '' : 's'} ago)`;
}

// What a subscription status is called when somebody reads it. The column
// holds 'expired', 'past_due', 'none' — fine as data, wrong on a screen. An
// account that never activated is neither expired nor lapsed; it simply has not
// started, and saying so is the difference between chasing a payment and
// chasing an activation email.
function statusWord(status, activatedAt) {
  if (!activatedAt) return 'Pending activation';
  switch (status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'On trial';
    case 'past_due':
      return 'Payment failed';
    case 'canceled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    default:
      return 'No subscription';
  }
}

// How long an unactivated account has left.
//
// Mirrors UNACTIVATED_LIFETIME_DAYS in server/src/jobs/billingJobs.js. The
// sweep deletes them five days after they were created, with reminders on the
// way, and until now nothing in the admin panel said so — an account simply
// stopped existing.
const UNACTIVATED_LIFETIME_DAYS = 5;

function deleteCountdown(createdAt) {
  if (!createdAt) return 'will be deleted if not activated';
  const goesAt = new Date(createdAt).getTime() + UNACTIVATED_LIFETIME_DAYS * 86400000;
  const days = Math.ceil((goesAt - Date.now()) / 86400000);
  if (Number.isNaN(days)) return 'will be deleted if not activated';
  if (days <= 0) return 'due to be deleted';
  return `deleted in ${days} day${days === 1 ? '' : 's'} if not activated`;
}

function date(value) {
  if (!value) return '—';
  return formatDateShort(value);
}

function dateTime(value) {
  if (!value) return '—';
  return formatDateTime(value);
}

// "Android app" and "Chrome on Android" are different support conversations,
// so they get different words and different icons.
function deviceIcon(device) {
  if (device === 'android-app') return 'phone';
  if (device === 'mobile') return 'phone';
  if (device === 'tablet') return 'image';
  if (device === 'desktop') return 'cpu';
  return 'globe';
}

function deviceLabel(d) {
  if (d.device === 'android-app') return 'Taxify Android app';
  const where = [d.platform, d.browser].filter(Boolean).join(' · ');
  const kind = d.device === 'tablet' ? 'Tablet' : d.device === 'mobile' ? 'Mobile' : d.device === 'desktop' ? 'Desktop' : 'Unknown';
  return where ? `${kind} — ${where}` : kind;
}

// The confirmations this panel asks for. Named rather than boolean so two
// cannot be open at once.
const NO_DIALOG = null;

function Field({ label, children, mono }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          wordBreak: 'break-word',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        }}
      >
        {children ?? '—'}
      </div>
    </div>
  );
}

// Each category is its own bordered block with a tinted header, rather than a
// heading and a hairline. Ten sections separated only by a rule read as one
// long scroll — you cannot see where "Activity" stops and "Billing" starts.
function Section({ title, icon, children, sticky = false }) {
  return (
    <section
      style={{
        ...(sticky
          ? {
              // Kept in reach on a long panel. These are the things somebody
              // opened the account to do, and scrolling past ten sections to
              // find them is how the panel gets closed and reopened.
              position: 'sticky',
              bottom: 0,
              zIndex: 2,
            }
          : null),
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--bg-card)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 14px',
          background: 'var(--bg-subtle)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Icon name={icon} size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 12.5 }}>{title}</span>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  );
}

// A class rather than an inline object, so a phone can collapse it to one
// column. Two columns of 150px on a 360px screen put a label and its value in
// less room than either needed.

// Everything known about one account, in one place. The list used to carry
// every fact and every action in a single row, which is why it was unreadable
// on a phone — the row is now a row, and this is where the detail lives.
export default function AdminUserDetail({ userId, me, onClose, onChanged, actions }) {
  // The page behind must not move while this is over it.
  useLockBodyScroll(true);
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  // Which confirmation is showing. One value rather than a boolean each, so
  // two can never be open at once.
  const [dialog, setDialog] = useState(NO_DIALOG);
  const [acting, setActing] = useState(false);

  // Sign-in history, folded down.
  //
  // Twenty rows of near-identical lines pushed everything after them off the
  // screen, and the reason anybody opens this section is almost never "read
  // all of them" — it is "when were they last on" or "is this happening from
  // one browser or several". So it opens on the last few, and the device chips
  // that were already here became the filter, since narrowing to one device is
  // the question they were describing anyway.
  const [showAllLogins, setShowAllLogins] = useState(false);
  const [loginDevice, setLoginDevice] = useState(null);

  // Escape closes, since the backdrop deliberately doesn't. Not while a
  // confirmation is up: that dialog owns Escape, and one key press should
  // dismiss one thing.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && dialog === NO_DIALOG) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/admin/users/${userId}`)
      .then((res) => !cancelled && setData(res.data))
      .catch((err) => {
        toast(err.message, 'error');
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Re-reads after an action so the panel never shows something that has just
  // been changed underneath it.
  async function refresh() {
    try {
      const res = await api.get(`/admin/users/${userId}`);
      setData(res.data);
    } catch {
      onClose();
    }
    onChanged?.();
  }

  const u = data?.user;
  const s = data?.stats;
  const isSelf = u?.id === me?.id;

  // Whether the Actions section has anything in it.
  //
  // Every control in there is conditional, and on an administrator looking at
  // their own row all three conditions fail at once: the role picker is hidden
  // because they already have everything it could grant, View as is hidden
  // because standing in your own shoes is not a thing, and Delete is hidden
  // because losing the last administrator locks everyone out for good. What
  // was left was a heading, a wrench icon and a blank space — a section that
  // announces there is something to do and then offers nothing.
  const canSetRole = !u?.isAdmin;
  const canViewAs = !isSelf;
  const canDelete = !isSelf && !u?.isAdmin;
  const hasActions = canSetRole || canViewAs || canDelete;

  return (
    <AnimatePresence>
      {/* The backdrop does not dismiss. This panel carries plan changes, free
          access grants and a delete button, and it scrolls — a press that lands
          beside the card while you are reading it should not throw the whole
          thing away. Escape and the X are the ways out. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(16, 24, 40, 0.45)',
          zIndex: 1400,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: 20,
          overflowY: 'auto',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          onClick={(e) => e.stopPropagation()}
          className="card admin-detail"
          // The card scrolls, not the backdrop behind it.
          //
          // It was overflow: hidden, so the sticky header was stuck to a box
          // that never moved while the whole card slid up the backdrop — the
          // name and email scrolled away, which on a long account is exactly
          // when they are wanted. Giving the card a height and its own
          // scrollbar is what makes sticky mean anything here, and it fixes the
          // sticky Actions block at the foot for the same reason.
          style={{
            width: '100%',
            maxWidth: 720,
            padding: 0,
            marginTop: 24,
            marginBottom: 24,
            maxHeight: 'calc(100dvh - 48px)',
            overflowY: 'auto',
            // Still hidden across, so the rounded corners keep their shape.
            overflowX: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              position: 'sticky',
              top: 0,
              background: 'var(--bg-card)',
              zIndex: 1,
            }}
          >
            <Avatar name={u?.name} avatarUrl={u?.avatarUrl} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{u?.name || 'Loading…'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{u?.email}</div>
            </div>
            <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </div>

          {!data ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <span className="spinner" /> Loading…
            </div>
          ) : (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 22 }}>
              <Section title="Account" icon="user">
                <div className="admin-grid">
                  <Field label="Role">
                    {u.isAdmin ? 'Administrator' : u.role === 'sub_user' ? 'Second login (legacy)' : u.role === 'accountant' ? 'Accountant' : 'Account holder'}
                  </Field>
                  {/* A login that belongs to somebody else has no plan of its
                      own — plan_type is NULL on those, and rendering NULL as
                      "Individual" said they were on a plan they had never had. */}
                  <Field label="Plan">
                    {u.role === 'owner' ? (u.planType === 'business' ? 'Small Business' : 'Individual') : '—'}
                  </Field>
                  <Field label="Status">
                    <span
                      style={{
                        color: u.accessBypass
                          ? 'var(--emerald)'
                          : u.subscriptionStatus === 'active'
                          ? 'var(--emerald)'
                          : u.subscriptionStatus === 'trialing'
                          ? 'var(--accent)'
                          : 'var(--red)',
                      }}
                    >
                      {/* The raw column was printed straight through, so this
                          read "expired", "past_due", "none" — database words
                          put in front of a person. */}
                      {u.accessBypass ? 'Access granted' : statusWord(u.subscriptionStatus, u.activatedAt)}
                    </span>
                  </Field>
                  <Field label="Joined">{date(u.createdAt)}</Field>
                  <Field label="Activated">
                    {u.activatedAt ? (
                      date(u.activatedAt)
                    ) : (
                      // Never activated, so it is on a five-day clock. Said
                      // here because the row disappears when it runs out, and
                      // "where did that account go" is the question this
                      // answers before it is asked.
                      <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                        Not yet — {deleteCountdown(u.createdAt)}
                      </span>
                    )}
                  </Field>
                  <Field label="Terms accepted">{date(u.termsAcceptedAt)}</Field>
                  {u.accountHolder && <Field label="Belongs to">{u.accountHolder.name}</Field>}
                  <Field label="Two-factor">{u.otpEnabled ? 'On' : 'Off'}</Field>
                </div>
              </Section>

              <Section title="Contact & details" icon="mail">
                <div className="admin-grid">
                  <Field label="First name">{u.firstName}</Field>
                  <Field label="Last name">{u.lastName}</Field>
                  <Field label="Phone">{u.phone}</Field>
                  <Field label="Date of birth">{u.dateOfBirth ? date(u.dateOfBirth) : '—'}</Field>
                  <Field label="Country">{u.country}</Field>
                  <Field label="State">{u.state}</Field>
                  <Field label="Currency">{u.currency}</Field>
                  {/* Business name and promo code are not shown here.
                      A set of books carries its own name now, so the one on
                      the user row is a leftover that contradicts what the
                      account actually shows, and the promo code belongs to the
                      billing history rather than to who somebody is. */}
                  <Field label="Heard about us">{u.referralSource}</Field>
                  {u.pendingEmail && <Field label="Pending email change">{u.pendingEmail}</Field>}
                </div>
              </Section>

              <Section title="Activity" icon="chart">
                <div className="admin-grid">
                  <Field label="Expenses">{s.expenses}</Field>
                  <Field label="With a receipt">
                    {s.withReceipt}
                    {s.expenses > 0 && (
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                        {' '}
                        ({Math.round((s.withReceipt / s.expenses) * 100)}%)
                      </span>
                    )}
                  </Field>
                  {/* No "Deleted" count on this screen.

                      The number is real — expenses are soft-deleted and purged
                      later, so stats.inTrash is still calculated and still
                      returned — but nothing in this panel acts on it. There is
                      no restore-from-here, so it was a figure that could be
                      read and not used, sitting in a grid where every other
                      figure answers a question somebody actually has. */}
                  <Field label="Total tracked">{formatMoney(s.totalAmount)}</Field>
                  <Field label="Categories">{s.categories}</Field>
                  <Field label="Documents">{s.documents}</Field>
                  <Field label="First expense">{date(s.firstExpense)}</Field>
                  <Field label="Latest expense">{date(s.lastExpense)}</Field>
                  <Field label="Last activity">{dateTime(s.lastActivity)}</Field>
                  <Field label="Storage used">{formatBytes(u.storageBytes)}</Field>
                </div>
              </Section>

              <Section title="Billing" icon="credit-card">
                <div className="admin-grid">
                  {/* Coloured once it has gone, and said in words.
                      A date with "(3 days ago)" beside it is still something to
                      work out, and the whole question being asked here is
                      whether this person can use the product today. */}
                  <Field label="Trial ends">
                    {u.trialEndsAt ? (
                      <span style={trialOver(u.trialEndsAt) ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
                        {date(u.trialEndsAt)} {daysAway(u.trialEndsAt)}
                        {trialOver(u.trialEndsAt) ? ' — ended' : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Field>
                  <Field label="Renews / ends">
                    {u.subscriptionCurrentPeriodEnd
                      ? `${date(u.subscriptionCurrentPeriodEnd)} ${daysAway(u.subscriptionCurrentPeriodEnd)}`
                      : '—'}
                  </Field>
                  <Field label="Granted access until">
                    {u.accessBypass ? (u.accessBypassUntil ? date(u.accessBypassUntil) : 'Open-ended') : '—'}
                  </Field>
                  <Field label="Stripe customer" mono>
                    {u.stripeCustomerId}
                  </Field>
                  <Field label="Stripe subscription" mono>
                    {u.stripeSubscriptionId}
                  </Field>
                </div>
              </Section>

              {data.members.length > 0 && (
                <Section title="People on this account" icon="users">
                  {data.members.map((m) => (
                    <div key={m.id} style={{ display: 'flex', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 120 }}>{m.email}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {m.role === 'sub_user' ? 'Second login (legacy)' : 'Accountant'}
                      </span>
                      <span style={{ color: m.active ? 'var(--emerald)' : 'var(--amber)' }}>
                        {m.active ? 'Active' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </Section>
              )}

              {data.accountants.length > 0 && (
                <Section title="Accountants with access" icon="briefcase">
                  {data.accountants.map((a) => (
                    <div key={a.id} style={{ display: 'flex', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                      <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 120 }}>{a.email}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {a.financialYears ? `FY ${a.financialYears.join(', ')}` : 'All years'}
                      </span>
                      <span style={{ color: a.expiresAt ? 'var(--amber)' : 'var(--text-muted)' }}>
                        {a.expiresAt ? `ends ${dateTime(a.expiresAt)}` : 'not opened'}
                      </span>
                    </div>
                  ))}
                </Section>
              )}

              {data.clients.length > 0 && (
                <Section title="Acts as accountant for" icon="briefcase">
                  {data.clients.map((c) => (
                    <div key={c.id} style={{ display: 'flex', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 120 }}>{c.email}</span>
                      <span style={{ color: c.expiresAt ? 'var(--amber)' : 'var(--text-muted)' }}>
                        {c.expiresAt ? `ends ${dateTime(c.expiresAt)}` : 'not opened'}
                      </span>
                    </div>
                  ))}
                </Section>
              )}

              {/* Tax years are not listed here.
                  Refunds, appointments and which years are finalised are the
                  account holder's own record, and reading them is not part of
                  administering the account. The server still sends them; this
                  panel simply does not put them on screen. */}

              {data.planChanges?.length > 0 && (
                <Section title="Plan changes" icon="credit-card">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.planChanges.map((c) => (
                      <div key={c.id} style={{ fontSize: 12.5, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                        {/* Plans by the names people are sold, and a status
                            in words rather than the column's own value —
                            "cancelled" reads as something somebody did, which
                            is what somebody reading this needs to know. */}
                        <div style={{ fontWeight: 600 }}>
                          {c.fromPlan ? planLabel(c.fromPlan) : '—'} → {planLabel(c.toPlan)}
                          <span style={{ color: planStatusTone(c.status), fontWeight: 400 }}>
                            {' '}
                            · {planStatusLabel(c.status)}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.6 }}>
                          Asked {dateTime(c.askedAt)}
                          {c.invoicedAt && ` · invoiced ${dateTime(c.invoicedAt)}`}
                          {c.amountCents != null &&
                            ` · ${formatMoney(c.amountCents / 100, (c.currency || 'AUD').toUpperCase())}`}
                          {c.paidAt && ` · paid ${dateTime(c.paidAt)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Sign-in history" icon="lock">
                {data.logins.total === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    No sign-ins recorded yet. (Only sign-ins since this was added are counted.)
                  </div>
                ) : (
                  <>
                    <div className="admin-grid">
                      <Field label="Total sign-ins">{data.logins.total}</Field>
                      <Field label="First seen">{dateTime(data.logins.firstAt)}</Field>
                      <Field label="Last seen">{dateTime(data.logins.lastAt)}</Field>
                    </div>

                    {/* What they actually use, most-used first — the fastest
                        way to know whether a support problem is the app or a
                        browser. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.logins.devices.map((d, i) => {
                        const key = deviceLabel(d);
                        const on = loginDevice === key;
                        return (
                          <button
                            key={i}
                            type="button"
                            title={`${d.count} sign-in${d.count === 1 ? '' : 's'} · last ${dateTime(d.lastAt)}`}
                            onClick={() => {
                              setLoginDevice(on ? null : key);
                              setShowAllLogins(false);
                            }}
                            // fontFamily, never the `font` shorthand.
                            //
                            // `font: 'inherit'` was set here after fontSize,
                            // and the shorthand resets every font property it
                            // does not name — so the size was thrown away and
                            // these chips came out at body size. Nothing warns
                            // about it; the declaration simply wins.
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              fontFamily: 'inherit',
                              fontSize: 11,
                              fontWeight: 600,
                              lineHeight: 1.4,
                              padding: '3px 8px',
                              borderRadius: 999,
                              cursor: 'pointer',
                              background: on ? 'var(--accent-soft)' : 'var(--bg-inset)',
                              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                              color: on ? 'var(--accent)' : 'inherit',
                            }}
                          >
                            <Icon name={deviceIcon(d.device)} size={11} />
                            {key} · {d.count}
                          </button>
                        );
                      })}
                      {loginDevice && (
                        <button
                          type="button"
                          onClick={() => setLoginDevice(null)}
                          style={{
                            fontSize: 11.5,
                            padding: '4px 10px',
                            borderRadius: 999,
                            border: '1px solid var(--border)',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          Show all devices
                        </button>
                      )}
                    </div>

                    {(() => {
                      const matching = loginDevice
                        ? data.logins.recent.filter((l) => deviceLabel(l) === loginDevice)
                        : data.logins.recent;
                      const shown = showAllLogins ? matching : matching.slice(0, 5);
                      const hidden = matching.length - shown.length;
                      return (
                        <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {shown.map((l, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 10,
                            fontSize: 12,
                            flexWrap: 'wrap',
                            padding: '5px 0',
                            borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                          }}
                        >
                          <Icon name={deviceIcon(l.device)} size={13} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ minWidth: 140 }}>{dateTime(l.at)}</span>
                          <span style={{ flex: 1, minWidth: 120, color: 'var(--text-muted)' }}>{deviceLabel(l)}</span>
                          {l.method && <span style={{ color: 'var(--text-muted)' }}>{l.method}</span>}
                          {l.ip && (
                            <span style={{ color: 'var(--text-subtle)', fontFamily: 'ui-monospace, monospace' }}>
                              {l.ip}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {matching.length === 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                        No sign-ins from {loginDevice} in the last {data.logins.recent.length}.
                      </div>
                    )}

                    {/* The count is on the button, so it is a decision rather
                        than a shrug — "another 15" is worth a click, "another
                        1" is not. */}
                    {(hidden > 0 || showAllLogins) && (
                      <button
                        type="button"
                        onClick={() => setShowAllLogins((v) => !v)}
                        style={{
                          alignSelf: 'flex-start',
                          marginTop: 6,
                          padding: 0,
                          border: 0,
                          background: 'none',
                          color: 'var(--accent)',
                          font: 'inherit',
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {showAllLogins ? 'Show fewer' : `Show ${hidden} more`}
                      </button>
                    )}
                        </>
                      );
                    })()}
                  </>
                )}
              </Section>

              <Section title="Plan &amp; billing" icon="credit-card">
                <PlanAndBilling user={u} onSaved={refresh} />
              </Section>

              {hasActions && (
              <Section title="Actions" icon="wrench">
                {/* The support team is a separate thing from administration:
                    it grants the ticket queue and nothing else. Somebody
                    answering tickets has no need to change plans or read
                    anybody's books, and giving them that anyway is how a
                    support login becomes the most valuable thing to steal. */}
                {/* Chosen from a list, not brushed with a switch.
                    A toggle invites a fingertip and gives no moment to read
                    what it does, and what it does here is hand somebody the
                    ability to read every customer's support conversation.
                    Picking a role and confirming it is two deliberate acts.

                    Not offered for an administrator at all: they already have
                    the queue and everything else besides, so the only thing
                    this could do for them is look as though it meant
                    something. */}
                {canSetRole && (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                    <label className="label" style={{ fontSize: 11.5 }}>
                      Role
                    </label>
                    <select
                      className="input"
                      value={u.isSupport ? 'support' : 'user'}
                      style={{ fontSize: 13 }}
                      onChange={async (event) => {
                        const next = event.target.value === 'support';
                        if (next === Boolean(u.isSupport)) return;

                        const ok = await confirm(
                          next
                            ? {
                                title: `Make ${u.name} a support operator?`,
                                body: 'They will be able to read every support conversation, including attachments people send in, and answer any ticket assigned to them. They get nothing else — no users, no billing, no Stripe.',
                                confirmLabel: 'Yes, make them an operator',
                                cancelLabel: 'Cancel',
                              }
                            : {
                                title: `Return ${u.name} to a regular user?`,
                                body: 'They lose the support queue straight away and stop receiving support email. Any open tickets they are holding go back to the queue to be picked up by somebody else, and the administrators are told.',
                                confirmLabel: 'Yes, remove them',
                                cancelLabel: 'Cancel',
                                danger: true,
                              }
                        );
                        // Put back where it was. The select is controlled by
                        // u.isSupport, so declining redraws it correctly on its
                        // own — but only once the state below is left alone.
                        if (!ok) return;

                        try {
                          await api.patch(`/admin/users/${u.id}`, { isSupport: next });
                          // This panel holds its own copy of the account, loaded
                          // once. Without updating it the dropdown springs back,
                          // because onChanged refreshes the list behind rather
                          // than the panel in front.
                          setData((prev) => (prev ? { ...prev, user: { ...prev.user, isSupport: next } } : prev));
                          toast(
                            next
                              ? `${u.name} is now a support operator`
                              : `${u.name} is no longer a support user`,
                            'success'
                          );
                          onChanged?.();
                        } catch (err) {
                          toast(err.message, 'error');
                        }
                      }}
                    >
                      <option value="user">Regular user</option>
                      <option value="support">Support operator</option>
                    </select>
                  </div>
                  <div style={{ flex: '2 1 240px', minWidth: 200 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      An operator reads the support queue and answers tickets assigned to them. Nothing else — no
                      users, no billing, no Stripe.
                    </div>
                  </div>
                </div>
                )}

                {/* An account that never opened its activation link has no
                    session to stand in — there is nothing to look at and
                    nothing it could show you. */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!isSelf && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12.5 }}
                      disabled={!u.active}
                      title={u.active ? undefined : 'This account has never been activated'}
                      onClick={() => setDialog('viewAs')}
                    >
                      View as this user
                    </button>
                  )}
                </div>
                {!u.active && !isSelf && (
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Viewing as this account is unavailable until they open their activation link.
                  </p>
                )}
              </Section>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* Not window.confirm, which cannot be styled, looks like a browser
          warning rather than something this app said, and on a phone is a
          system sheet with no relationship to the page. */}
      <ConfirmDialog
        open={dialog === 'viewAs'}
        title={`View Taxify as ${u?.name || 'this user'}?`}
        body="You will see their account exactly as they do."
        detail="Nothing can be changed while you are in there — every route is read-only — and a banner stays on screen until you leave."
        confirmLabel="View as this user"
        busy={acting}
        onCancel={() => setDialog(NO_DIALOG)}
        onConfirm={async () => {
          setActing(true);
          try {
            await actions.viewAs(u);
          } finally {
            setActing(false);
            setDialog(NO_DIALOG);
          }
        }}
      />
    </AnimatePresence>
  );
}

// Plan and how it is paid for, as one decision.
//
// Which plan somebody is on and whether they are charged for it were two
// separate controls, and setting both meant two requests — leaving a window
// where an account was on a plan it was about to be given for free. Sent
// together now, and nothing is applied until it is confirmed.
function PlanAndBilling({ user, onSaved }) {
  const toast = useToast();
  const [planType, setPlanType] = useState(user.planType === 'business' ? 'business' : 'individual');
  const [complimentary, setComplimentary] = useState(!!user.accessBypass);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Free access is for an account that is not paying for one.
  //
  // Somebody on a live subscription is already being charged by Stripe, and
  // this setting does not touch Stripe — so ticking it there grants them the
  // plan twice over and keeps taking their money, which reads as a billing
  // fault and is one. Offered on a trial or a lapsed account, where there is
  // nothing being charged to contradict.
  //
  // Always offered when it is already on, or turning it off again would be
  // impossible.
  const trialing = user.subscriptionStatus === 'trialing';
  const paying = user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due';

  // Warned about, not refused.
  //
  // This used to disable the checkbox whenever Stripe was charging, which
  // reads as a safety rail and behaves as a wall: the person most likely to
  // want it is whoever owns the business, on their own account, and their
  // account is the one most likely to be marked active. Being told "not
  // available" by your own admin panel, with no way to proceed, is worse than
  // being told what it will cost you.
  //
  // The risk has not changed and is not hidden — the warning below still says
  // it, and the confirmation repeats it with the amount of the thing at stake:
  // this does not touch Stripe, so the charge continues until it is cancelled
  // there. That is a decision an administrator is entitled to make with the
  // facts in front of them.
  const chargingWhileFree = paying && !user.accessBypass;

  const label = planType === 'business' ? 'Small Business' : 'Individual';
  const dirty =
    planType !== (user.planType === 'business' ? 'business' : 'individual') ||
    complimentary !== !!user.accessBypass ||
    false;

  const moving = planType !== (user.planType === 'business' ? 'business' : 'individual');

  async function save() {
    setBusy(true);
    try {
      const { data } = await api.patch(`/admin/users/${user.id}/plan`, {
        planType,
        complimentary,
        until: null,
      });

      // Said back, because "free plan granted" and "free plan granted but they
      // are still being charged" are different outcomes and only one of them
      // needs somebody to go and do something. A failure to reach Stripe does
      // not block the grant, so this is the only place it surfaces.
      if (data?.cancelProblem) {
        toast(`Plan updated, but their subscription could not be cancelled: ${data.cancelProblem}`, 'error');
      } else {
        toast(data?.subscriptionCancelled ? 'Plan updated — subscription cancelled' : 'Plan updated', 'success');
      }
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { value: 'individual', label: 'Individual' },
          { value: 'business', label: 'Small Business' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={planType === option.value ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ fontSize: 12.5 }}
            onClick={() => setPlanType(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={complimentary}
          onChange={(e) => setComplimentary(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Free — do not charge for this plan</strong>
          <span
            style={{
              display: 'block',
              fontSize: 12,
              lineHeight: 1.5,
              color: chargingWhileFree && complimentary ? 'var(--red)' : 'var(--text-muted)',
            }}
          >
            {chargingWhileFree && complimentary
              ? 'They have a live subscription. Applying this cancels it at the end of the period they have already paid for — no refund, no early cut-off, and no charge after that.'
              : 'Free until you turn it off. Full use of the plan, with nothing to pay and no subscription.'}
          </span>
        </span>
      </label>

      <div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12.5 }}
          disabled={!dirty || busy}
          onClick={() => setConfirming(true)}
        >
          Apply
        </button>

        <ConfirmDialog
          open={confirming}
          title={`Move this account to ${label}?`}
          // What the plan actually gives them, not just its name. An
          // administrator moving somebody between plans is making a decision
          // about what that person can do, and 'Small Business' does not say
          // what that is.
          body={
            <>
              <div style={{ marginBottom: 10 }}>{user.email} will be on the {label} plan.</div>
              {/* Repeated here, at the moment of committing, because the
                  checkbox is a warning somebody has already read past by the
                  time they reach this button. */}
              {chargingWhileFree && complimentary && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: '9px 11px',
                    borderRadius: 8,
                    border: '1px solid var(--red)',
                    background: 'rgba(220, 38, 38, .08)',
                    fontSize: 12.5,
                    lineHeight: 1.6,
                  }}
                >
                  <strong>Their subscription will be cancelled.</strong> It stops at the end of the period they have
                  already paid for, so nothing is refunded and nothing is taken away early — they keep the days they
                  bought and are not charged again.
                </div>
              )}
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>What they get</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-muted)' }}>
                {(planType === 'business'
                  ? [
                      'Their own individual tax — 1 set of books',
                      'Up to 2 small businesses, each with its own books',
                      'Separate reports and filing for each',
                      'Unlimited expenses and receipts',
                      'Accountant access',
                    ]
                  : [
                      'Their own individual tax — 1 set of books',
                      'Unlimited expenses and receipts',
                      'Year-over-year reports and exports',
                      'Accountant access',
                      'No business books — any they have stop being reachable',
                    ]
                ).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          }
          detail={
            complimentary
              ? 'They will not be charged for it, and it stays that way until somebody turns it off here. Any Stripe subscription they already have is untouched — cancel that in Stripe if you mean to.'
              : user.accessBypass
              ? 'They will be billed normally from now on.'
              : moving
              ? 'They will be emailed about the change, the same as if they had made it themselves.'
              : undefined
          }
          confirmLabel="Apply"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await save();
            setConfirming(false);
          }}
        />
      </div>
    </div>
  );
}
