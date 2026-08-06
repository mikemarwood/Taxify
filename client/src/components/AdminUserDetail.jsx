import { useEffect, useState } from 'react';
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

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 };

// Everything known about one account, in one place. The list used to carry
// every fact and every action in a single row, which is why it was unreadable
// on a phone — the row is now a row, and this is where the detail lives.
export default function AdminUserDetail({ userId, me, onClose, onChanged, actions }) {
  const toast = useToast();
  const [data, setData] = useState(null);

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
          className="card"
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
                <div style={GRID}>
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
                <div style={GRID}>
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
                <div style={GRID}>
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
                <div style={GRID}>
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
                    <div style={GRID}>
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

              <Section title="Actions" icon="wrench">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12.5 }}
                    onClick={() => actions.changePlan(u).then(refresh)}
                  >
                    Move to {u.planType === 'business' ? 'Individual' : 'Small Business'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12.5, color: u.accessBypass ? 'var(--emerald)' : undefined }}
                    onClick={() => actions.toggleAccess(u).then(refresh)}
                  >
                    {u.accessBypass ? 'Revoke granted access' : 'Grant access'}
                  </button>
                  {!isSelf && (
                    <>
                      <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => actions.viewAs(u)}>
                        View as this user
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12.5 }}
                        onClick={() => actions.toggleAdmin(u).then(refresh)}
                      >
                        {u.isAdmin ? 'Remove administrator' : 'Make administrator'}
                      </button>
                      {/* Admins are never deletable — losing the last one locks
                          everyone out of this panel for good. */}
                      {!u.isAdmin && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 12.5, color: 'var(--red)' }}
                          onClick={() =>
                            actions.deleteUser(u).then((deleted) => {
                              if (deleted) onClose();
                              else refresh();
                            })
                          }
                        >
                          Delete account
                        </button>
                      )}
                    </>
                  )}
                </div>
              </Section>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
