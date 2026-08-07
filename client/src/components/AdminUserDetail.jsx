import { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { formatMoney } from '../lib/money.js';
import { formatDateShort, formatDateTime } from '../lib/dates.js';

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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

function Section({ title, icon, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
      {children}
    </div>
  );
}

// A class rather than an inline object, so a phone can collapse it to one
// column. Two columns of 150px on a 360px screen put a label and its value in
// less room than either needed.

// Everything known about one account, in one place. The list used to carry
// every fact and every action in a single row, which is why it was unreadable
// on a phone — the row is now a row, and this is where the detail lives.
export default function AdminUserDetail({ userId, me, onClose, onChanged, actions }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  // Which confirmation is showing. One value rather than a boolean each, so
  // two can never be open at once.
  const [dialog, setDialog] = useState(NO_DIALOG);
  const [acting, setActing] = useState(false);

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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
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
          style={{ width: '100%', maxWidth: 720, padding: 0, marginTop: 24, marginBottom: 24, overflow: 'hidden' }}
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
                      {u.accessBypass ? 'Access granted' : u.subscriptionStatus || 'none'}
                    </span>
                  </Field>
                  <Field label="Joined">{date(u.createdAt)}</Field>
                  <Field label="Activated">{u.activatedAt ? date(u.activatedAt) : 'Not yet'}</Field>
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
                  <Field label="Business name">{u.businessName}</Field>
                  <Field label="Heard about us">{u.referralSource}</Field>
                  <Field label="Promo code">{u.promoCode}</Field>
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
                  <Field label="Deleted">{s.inTrash}</Field>
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
                  <Field label="Trial ends">{date(u.trialEndsAt)}</Field>
                  <Field label="Renews / ends">{date(u.subscriptionCurrentPeriodEnd)}</Field>
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

              {data.taxYears.length > 0 && (
                <Section title="Tax years" icon="cash">
                  {data.taxYears.map((t) => (
                    <div key={t.financialYear} style={{ display: 'flex', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, minWidth: 80 }}>FY {t.financialYear}</span>
                      <span style={{ flex: 1, minWidth: 100, color: 'var(--text-muted)' }}>
                        {t.amount === null ? 'No refund recorded' : `${formatMoney(t.amount)} refunded`}
                      </span>
                      {t.appointmentAt && (
                        <span style={{ color: 'var(--text-muted)' }}>appt {dateTime(t.appointmentAt)}</span>
                      )}
                      {t.finalisedAt && <span style={{ color: 'var(--emerald)' }}>finalised</span>}
                    </div>
                  ))}
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
                      {data.logins.devices.map((d, i) => (
                        <span
                          key={i}
                          title={`${d.count} sign-in${d.count === 1 ? '' : 's'} · last ${dateTime(d.lastAt)}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: 999,
                            background: 'var(--bg-inset)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <Icon name={deviceIcon(d.device)} size={12} />
                          {deviceLabel(d)} · {d.count}
                        </span>
                      ))}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {data.logins.recent.map((l, i) => (
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
                  </>
                )}
              </Section>

              <Section title="Plan &amp; billing" icon="credit-card">
                <PlanAndBilling user={u} onSaved={refresh} />
              </Section>

              <Section title="Actions" icon="wrench">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!isSelf && (
                    <>
                      {/* An account that never opened its activation link has
                          no session to stand in — there is nothing to look at
                          and nothing it could show you. */}
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12.5 }}
                        disabled={!u.active}
                        title={u.active ? undefined : 'This account has never been activated'}
                        onClick={() => setDialog('viewAs')}
                      >
                        View as this user
                      </button>
                      {/* Admins are never deletable — losing the last one locks
                          everyone out of this panel for good. */}
                      {!u.isAdmin && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 12.5, color: 'var(--red)' }}
                          onClick={() => setDialog('delete')}
                        >
                          Delete account
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!u.active && !isSelf && (
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Viewing as this account is unavailable until they open their activation link.
                  </p>
                )}
              </Section>
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* The confirmations. Both were window.confirm, which cannot be styled,
          looks like a browser warning rather than something this app said, and
          on a phone is a system sheet with no relationship to the page. */}
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

      <ConfirmDialog
        open={dialog === 'delete'}
        tone="danger"
        title="Delete this account?"
        body={`Everything belonging to ${u?.email || 'this account'} is removed: expenses, categories, receipts and documents.`}
        detail={`${formatBytes(u?.storageBytes)} of files will be deleted from disk. There is no undo, and no copy kept.`}
        confirmLabel="Delete permanently"
        requireText={u?.email}
        dismissOnBackdrop={false}
        busy={acting}
        onCancel={() => setDialog(NO_DIALOG)}
        onConfirm={async () => {
          setActing(true);
          try {
            const deleted = await actions.deleteUser(u);
            setDialog(NO_DIALOG);
            if (deleted) onClose();
            else refresh();
          } finally {
            setActing(false);
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

  const label = planType === 'business' ? 'Small Business' : 'Individual';
  const dirty =
    planType !== (user.planType === 'business' ? 'business' : 'individual') ||
    complimentary !== !!user.accessBypass ||
    false;

  const moving = planType !== (user.planType === 'business' ? 'business' : 'individual');

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/admin/users/${user.id}/plan`, {
        planType,
        complimentary,
        until: null,
      });
      toast('Plan updated', 'success');
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
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Free until you turn it off. Full use of the plan with no subscription — any Stripe subscription they
            already have is untouched, so cancel that in Stripe if you mean to.
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
          body={`${user.email} will be on the ${label} plan.`}
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
