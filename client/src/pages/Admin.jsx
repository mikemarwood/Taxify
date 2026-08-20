import { useEffect, useState } from 'react';
import LandingAdsTab from '../components/LandingAdsTab.jsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  categoryNameError,
  isCategoryNameReady,
  tidyCategoryName,
} from '../lib/categoryName.js';
import { useToast } from '../components/Toast.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import Icon from '../components/Icon.jsx';
import WebhookHealth from '../components/WebhookHealth.jsx';
import PromoCodesTab from '../components/PromoCodesTab.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import AdminStatsTab from '../components/AdminStatsTab.jsx';
import SupportTab from '../components/SupportTab.jsx';
import LockedPanel from '../components/LockedPanel.jsx';
import HowItWorksTab from '../components/HowItWorksTab.jsx';
import ToolsTab from '../components/ToolsTab.jsx';
import { useSupportCounts } from '../lib/useSupportCounts.js';
import PushSettingsTab from '../components/PushSettingsTab.jsx';
import { IconPicker, ColourPicker, CategoryPreview, SWATCHES } from '../components/CategoryPickers.jsx';
import Avatar from '../components/Avatar.jsx';
import AdminUserDetail from '../components/AdminUserDetail.jsx';
import { planLabel } from '../lib/plans.js';


// Storage figures are for a human deciding whether someone is using a lot, so
// one decimal at MB and above is plenty — the exact byte count would be noise.
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// The tabs, in the two groups they actually fall into: the ones opened most
// days, and the ones opened when something is being set up or changed.
//
// They were eleven identical pills wrapping onto three rows, in no order —
// Stripe next to Users next to Promo codes — so finding one meant reading all
// of them. Grouping is the whole fix; the icons are so a tab can be found by
// shape once its position is known.
const TAB_GROUPS = [
  {
    title: 'Day to day',
    tabs: [
      { key: 'stats', label: 'Live stats', icon: 'chart' },
      { key: 'support', label: 'Support', icon: 'mail' },
      { key: 'users', label: 'Users', icon: 'users' },
      { key: 'tools', label: 'Tools', icon: 'wrench' },
    ],
  },
  {
    title: 'Set up',
    tabs: [
      { key: 'categories', label: 'Default categories', icon: 'tag' },
      { key: 'settings', label: 'Settings', icon: 'settings' },
      { key: 'email', label: 'Email server', icon: 'mail' },
      { key: 'stripe', label: 'Stripe', icon: 'cash' },
      { key: 'promos', label: 'Promo codes', icon: 'gift' },
      { key: 'push', label: 'Firebase', icon: 'bell' },
      { key: 'landing', label: 'Landing page', icon: 'image' },
    ],
  },
];

// Every tab this page has. Used to decide whether a ?tab= is one we know,
// rather than trusting the URL and rendering nothing.
//
// 'how' is in here but not in TAB_GROUPS on purpose. It is a reference page
// read once, not somewhere to go most days, and it was taking a slot in the
// strip from tabs that are. It opens from the button on Live stats, and the
// ?tab=how link still works.
const TAB_KEYS = [...TAB_GROUPS.flatMap((group) => group.tabs.map((t) => t.key)), 'how'];

// Tabs somebody on the support team may see. Everything else on this page —
// users, billing, Stripe keys, promo codes, the live stats — is administrators
// only, and a support account should not even see the tab. A tab that is
// visible but refuses the press invites the press; one that is absent says
// nothing about what is behind it.
const SUPPORT_TABS = ['support'];

// How many days are left on a trial, and whether it has already gone.
//
// Read from trial_ends_at rather than from the status, because the status
// stays "trialing" after the date passes — nothing rewrites it on the way
// through, and the nightly job only ever moves somebody who acts. So an
// account can read "On trial" for weeks after the trial ended, which is the
// opposite of what somebody scanning this list needs to know.
function trialDaysLeft(user) {
  if (user?.subscriptionStatus !== 'trialing' || !user?.trialEndsAt) return null;
  return Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / 86400000);
}

function trialLapsed(user) {
  const left = trialDaysLeft(user);
  return left !== null && left <= 0;
}

// Whether the plan is paid up today.
//
// The date is checked as well as the status, because subscription_status only
// moves when something happens — a webhook, a job, somebody paying. Nothing
// rewrites it as a date quietly goes by, so an account reads 'active' or
// 'trialing' long after it stopped being either. Filtering on the status alone
// would put lapsed accounts in the Active list, which is the one thing these
// filters must never do.
function onTrial(user) {
  // Activated, or it is not a trial yet. subscription_status defaults to
  // trialing on the column, so a sign-up that never opened its activation link
  // reads as on trial while having no end date and no access — the clock only
  // starts when they confirm their email. Without this they turn up under On
  // trial as well as Not activated, which double-counts the one thing this
  // list is for.
  return Boolean(user?.active) && user?.subscriptionStatus === 'trialing';
}

function stillRunning(value) {
  return !value || new Date(value).getTime() > Date.now();
}

function planCurrent(user) {
  if (!user?.active) return false;
  // Granted access outranks everything, the same as it does on the server.
  if (user.accessBypass) return stillRunning(user.accessBypassUntil);
  if (onTrial(user)) return !trialLapsed(user);
  if (user.subscriptionStatus === 'active') return stillRunning(user.subscriptionCurrentPeriodEnd);
  return false;
}

// Had access and lost it. Not somebody who never activated — that is a
// different list and a different conversation — and not an accountant, who has
// no plan to expire.
function planExpired(user) {
  return Boolean(user?.active) && user.role !== 'accountant' && !planCurrent(user);
}

function trialBadge(user) {
  const left = trialDaysLeft(user);
  if (left === null) return 'On trial';
  if (left === 1) return 'Trial · 1 day left';
  return `Trial · ${left} days left`;
}

export default function Admin() {
  // ?tab= opens a particular one, because the notifications link straight here.
  // "Somebody wants to change plan" is no use if the link lands on Live stats
  // and leaves you to find the right tab yourself.
  // The same count the sidebar badge uses, so the two cannot disagree.
  const { user } = useAuth();
  // Support staff see the queue and nothing else on this page.
  const supportOnly = !user?.isAdmin && Boolean(user?.isSupport);
  const allowed = supportOnly ? SUPPORT_TABS : TAB_KEYS;
  // Support staff get the queue and nothing else, so the group headings would
  // be labelling a single button.
  const groups = supportOnly
    ? [{ title: null, tabs: [{ key: 'support', label: 'Support', icon: 'mail' }] }]
    : TAB_GROUPS;

  const { queue } = useSupportCounts({ isAdmin: true });
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  // Named rather than taken as "the first one in the list".
  //
  // allowed[0] was how the default was chosen, so moving How it works to the
  // front of TAB_KEYS to keep ?tab=how working quietly made a reference page
  // the first thing an administrator saw. A default worth having is a default
  // worth writing down.
  const fallback = supportOnly ? 'support' : 'stats';
  const [tab, setTabState] = useState(allowed.includes(requested) ? requested : fallback);

  // Kept in the URL, so the tab survives a refresh and can be linked to.
  function setTab(next) {
    setTabState(next);
    setSearchParams(next === 'stats' ? {} : { tab: next }, { replace: true });
  }

  return (
    <div style={{ maxWidth: tab === 'stats' || tab === 'support' || tab === 'how' ? 1100 : 760 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Administration</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Manage user accounts and the default category template.</p>

      {/* One bordered strip rather than eleven loose pills. The groups are
          separated by a rule, not by a gap somebody has to interpret. */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-card)',
          padding: 12,
          marginBottom: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {groups.map((group, index) => (
          <div key={group.title || 'only'} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {index > 0 && <span style={{ height: 1, background: 'var(--border)', margin: '2px 0 5px' }} />}
            {group.title && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: 0.7,
                  textTransform: 'uppercase',
                  color: 'var(--text-subtle)',
                }}
              >
                {group.title}
              </span>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {group.tabs.map((item) => {
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setTab(item.key)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '7px 12px',
                      borderRadius: 999,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontFamily: 'inherit',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent)' : 'transparent',
                      color: active ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    <Icon name={item.icon} size={13} />
                    {item.label}
                    {/* Only when something is waiting. A zero here would be a
                        badge announcing that there is nothing to announce. */}
                    {item.key === 'support' && queue > 0 && (
                      <span
                        style={{
                          minWidth: 18,
                          height: 18,
                          padding: '0 5px',
                          borderRadius: 999,
                          background: active ? 'rgba(255,255,255,.24)' : 'var(--red)',
                          color: '#fff',
                          fontSize: 10.5,
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {queue > 99 ? '99+' : queue}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {tab === 'stats' && <AdminStatsTab onHowItWorks={() => setTab('how')} />}
      {tab === 'support' && <SupportTab />}
      {tab === 'tools' && <ToolsTab />}
      {tab === 'how' && <HowItWorksTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'categories' && (
        <LockedPanel
          title="Default categories"
          hint="Two lists: one for personal books, one for business books. Every new set of books is built from the matching one. Editing them does not touch books that already exist."
        >
          <DefaultCategoriesTab />
        </LockedPanel>
      )}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'email' && (
        <LockedPanel title="The email server" hint="Every email the site sends goes through these settings. A wrong value here is silent — nothing arrives, and nobody is told.">
          <EmailSettingsTab />
        </LockedPanel>
      )}
      {tab === 'stripe' && <StripeSettingsTab />}
      {tab === 'promos' && <PromoCodesTab />}
      {tab === 'landing' && <LandingAdsTab />}
      {tab === 'push' && (
        <LockedPanel title="Firebase" hint="This is what carries notifications to people's phones. Replacing the key is how they stop arriving.">
          <PushSettingsTab />
        </LockedPanel>
      )}
    </div>
  );
}

const BADGE_TONES = {
  red: { color: 'var(--red)', background: 'rgba(239, 68, 68, 0.13)' },
  amber: { color: 'var(--amber)', background: 'rgba(245, 158, 11, 0.14)' },
  emerald: { color: 'var(--emerald)', background: 'rgba(12, 115, 67, 0.12)' },
  accent: { color: 'var(--accent)', background: 'var(--accent-soft)' },
  muted: { color: 'var(--text-muted)', background: 'var(--bg-inset)' },
};

function Badge({ tone = 'muted', children }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        ...BADGE_TONES[tone],
      }}
    >
      {children}
    </span>
  );
}

function UsersTab() {
  const { user: me, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  function load() {
    api.get('/admin/users').then((res) => setUsers(res.data.users));
  }
  useEffect(load, []);
  // Confirmed by AdminUserDetail before this is called — it can ask in a
  // dialog that looks like the rest of the app, which window.confirm cannot.
  async function viewAs(u) {
    try {
      const res = await api.post(`/admin/users/${u.id}/view-as`);
      setUser(res.data.user);
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // The confirmation, and the typing of the email that goes with it, happen
  // in AdminUserDetail. The email still has to be typed — it is the only check
  // that the row being deleted is the row that was meant, and a mis-click
  // cannot pass it.
  async function deleteUser(u) {
    try {
      const res = await api.delete(`/admin/users/${u.id}`);
      const extra = res.data?.deletedDependents
        ? ` and ${res.data.deletedDependents} linked login${res.data.deletedDependents === 1 ? '' : 's'}`
        : '';
      toast(`Deleted ${u.email}${extra}`, 'success');
      load();
      // Reported back so the detail panel closes rather than reloading an
      // account that no longer exists.
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  }

  // What each filter means, in one place, so the count on a chip and the rows
  // it shows can never disagree.
  const FILTERS = [
    // The four that answer what this page is usually opened to find out: who
    // can use Taxify today, and who cannot.
    { key: 'all', label: 'Everyone', match: () => true },
    { key: 'current', label: 'Active', match: planCurrent },
    { key: 'trialing', label: 'On trial', match: (u) => onTrial(u) && !trialLapsed(u) },
    { key: 'expired', label: 'Plan expired', match: planExpired },

    // Invited or signed up and never opened the link. These are the accounts
    // worth chasing, and they were indistinguishable in a list.
    { key: 'pending', label: 'Not activated', match: (u) => !u.active },
    { key: 'paying', label: 'Paying', match: (u) => planCurrent(u) && !u.accessBypass && !onTrial(u) },
    { key: 'due', label: 'Payment failed', match: (u) => u.subscriptionStatus === 'past_due' },
    { key: 'free', label: 'Free', match: (u) => !!u.accessBypass },
    { key: 'individual', label: 'Individual', match: (u) => u.role === 'owner' && u.planType !== 'business' },
    { key: 'business', label: 'Small Business', match: (u) => u.role === 'owner' && u.planType === 'business' },
    { key: 'accountant', label: 'Accountants', match: (u) => u.role === 'accountant' },
    { key: 'admin', label: 'Administrators', match: (u) => !!u.isAdmin },
    { key: 'support', label: 'Support team', match: (u) => !!u.isSupport },
  ];

  const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const term = search.trim().toLowerCase();
  const shown = (users || []).filter(
    (u) =>
      active.match(u) &&
      (!term || u.name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term))
  );

  return (
    <div>
      {users !== null && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginBottom: 14,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <label className="label" htmlFor="admin-user-search">
              Search
            </label>
            <input
              id="admin-user-search"
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
            />
          </div>

          {/* One control rather than ten chips. The counts were the useful part
              — "Payment due (3)" is a job to do — so they come with it, but a
              wrapping row of ten of them was most of what made this page look
              busy before a single account had loaded. */}
          <div style={{ flex: '0 1 250px', minWidth: 180 }}>
            <label className="label" htmlFor="admin-user-filter">
              Show
            </label>
            <select
              id="admin-user-filter"
              className="input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} ({users.filter(f.match).length})
                </option>
              ))}
            </select>
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', paddingBottom: 10, whiteSpace: 'nowrap' }}>
            {shown.length} shown
          </div>
        </div>
      )}

      {users === null ? (
        <SkeletonList rows={4} />
      ) : (
        shown.length === 0 ? (
          <div className="card" style={{ padding: 22, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            No accounts match that.
          </div>
        ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            {shown.map((u, i) => (
              <motion.button
                key={u.id}
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDetailId(u.id)}
                className="admin-user-row"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 16px',
                  border: 0,
                  background: 'none',
                  font: 'inherit',
                  color: 'var(--text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderBottom: i < shown.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <Avatar name={u.name} avatarUrl={u.avatarUrl} size={34} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {/* Struck through once the trial has run out.
                        A list of names all rendered the same way makes the
                        lapsed ones invisible — you had to open each account to
                        find out. The line is only ever drawn for a trial that
                        has actually ended, not for a subscription that was
                        cancelled or a payment that failed: those are different
                        problems and deserve their own reading. */}
                    <span style={trialLapsed(u) ? { textDecoration: 'line-through', opacity: 0.65 } : undefined}>
                      {u.name}
                    </span>{' '}
                    {u.id === me.id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(you)</span>}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {u.email}
                  </div>

                  {/* The badges wrap under the name rather than competing with
                      it for the same line — which is what made this unreadable
                      on a phone. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                    {/* Support staff are marked the way administrators are.
                        They can read every customer's support conversation, and
                        that is worth seeing in a list of accounts rather than
                        only by opening each one. */}
                    <Badge
                      tone={
                        u.isAdmin || u.isSupport
                          ? 'red'
                          : u.role === 'sub_user' || u.role === 'accountant'
                          ? 'amber'
                          : 'accent'
                      }
                    >
                      {u.isAdmin
                        ? 'Administrator'
                        : u.isSupport
                        ? 'Support team'
                        : u.role === 'sub_user'
                        ? 'Second login (legacy)'
                        : u.role === 'accountant'
                        ? 'Accountant'
                        : planLabel(u.planType)}
                    </Badge>

                    {/* An administrator is also somebody's customer.
                        This badge showed the role *instead* of the plan, so the
                        two people most likely to be looked up — whoever runs
                        the place and whoever answers the tickets — were the
                        only two whose plan the list would not say. They pay
                        like anybody else. An accountant is the exception that
                        stays: they genuinely have no plan. */}
                    {(u.isAdmin || u.isSupport) && u.role !== 'accountant' && (
                      <Badge tone="accent">{planLabel(u.planType)}</Badge>
                    )}
                    {/* What state the account is actually in, in words.
                        "Invite pending" appeared only for unactivated accounts
                        and nothing at all for the rest, so a row gave no way to
                        tell somebody paying from somebody lapsed without
                        opening them. */}
                    {!u.active ? (
                      <Badge tone="amber">Pending activation</Badge>
                    ) : u.role === 'accountant' ? (
                      // Somebody who only acts for clients has no plan, so no
                      // plan state to report. Checked before the statuses
                      // because the column defaults to trialing and never
                      // stops saying so — an accountant would otherwise be
                      // badged as on a trial they were never given, or as
                      // expired for a plan they never had.
                      <Badge tone="muted">No plan needed</Badge>
                    ) : u.accessBypass ? (
                      <Badge tone="emerald">Access granted</Badge>
                    ) : u.subscriptionStatus === 'active' ? (
                      <Badge tone="emerald">Active</Badge>
                    ) : u.subscriptionStatus === 'trialing' ? (
                      // How long is left, not merely that a trial exists. The
                      // question anybody scanning this list is actually asking
                      // is which of these is about to lapse.
                      trialLapsed(u) ? (
                        <Badge tone="red">Trial ended</Badge>
                      ) : (
                        <Badge tone="accent">{trialBadge(u)}</Badge>
                      )
                    ) : u.subscriptionStatus === 'past_due' ? (
                      <Badge tone="red">Payment failed</Badge>
                    ) : u.subscriptionStatus === 'canceled' ? (
                      <Badge tone="red">Cancelled</Badge>
                    ) : (
                      <Badge tone="red">Expired</Badge>
                    )}
                    <Badge tone="muted">
                      {u.expenseCount} expense{u.expenseCount === 1 ? '' : 's'}
                    </Badge>
                    <Badge tone="muted">{formatBytes(u.storageBytes)}</Badge>
                  </div>
                </div>

                <Icon name="chevron-down" size={16} style={{ color: 'var(--text-muted)', transform: 'rotate(-90deg)' }} />
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
        )
      )}

      {detailId !== null && (
        <AdminUserDetail
          userId={detailId}
          me={me}
          onClose={() => setDetailId(null)}
          onChanged={load}
          actions={{ viewAs, deleteUser }}
        />
      )}
    </div>
  );
}

function SettingsTab() {
  const toast = useToast();
  const [registrationEnabled, setRegistrationEnabled] = useState(null);
  const [mfaMode, setMfaMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/settings').then((res) => {
      setRegistrationEnabled(res.data.registrationEnabled);
      setMfaMode(res.data.mfaMode);
    });
  }, []);

  async function toggle() {
    const next = !registrationEnabled;
    setBusy(true);
    try {
      await api.patch('/admin/settings', { registrationEnabled: next });
      setRegistrationEnabled(next);
      toast(next ? 'Registrations are now open' : 'Registrations are now closed', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode) {
    if (mode === mfaMode) return;
    setMfaBusy(true);
    try {
      await api.patch('/admin/settings', { mfaMode: mode });
      setMfaMode(mode);
      toast(
        mode === 'required' ? 'MFA is now required for every account' : 'MFA is now optional — users choose for themselves',
        'success'
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMfaBusy(false);
    }
  }

  if (registrationEnabled === null || mfaMode === null) return <SkeletonList rows={2} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700 }}>New account registration</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {registrationEnabled
              ? 'Anyone can currently create a new Taxify account.'
              : 'Sign-ups are closed — existing accounts can still log in normally.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={registrationEnabled}
          aria-label="New account registration"
          disabled={busy}
          onClick={toggle}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 13px 7px 9px',
            borderRadius: 999,
            cursor: busy ? 'wait' : 'pointer',
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            border: `1px solid ${registrationEnabled ? 'var(--emerald)' : 'var(--border-strong)'}`,
            background: registrationEnabled ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-inset)',
            color: registrationEnabled ? 'var(--emerald)' : 'var(--text-muted)',
          }}
        >
          {/* The track and knob carry the state; the word beside them only
              repeats it. Previously the button named the action instead — a
              blue "Turn on" read as something that was already on. */}
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 20,
              borderRadius: 999,
              padding: 2,
              flexShrink: 0,
              display: 'flex',
              justifyContent: registrationEnabled ? 'flex-end' : 'flex-start',
              background: registrationEnabled ? 'var(--emerald)' : 'var(--border-strong)',
              transition: 'background 0.15s ease',
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            />
          </span>
          {registrationEnabled ? 'Open' : 'Closed'}
        </button>
      </div>
      {/* Not a setting. Two-factor is required of every account, always.
          This app holds people's tax records and lets an accountant read
          them; there is no version of that where a password alone is enough,
          and a switch that could turn it off is a switch that eventually gets
          turned off — by somebody in a hurry, for one account, permanently. */}
      <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="lock" size={18} style={{ color: 'var(--emerald)' }} />
        <div>
          <div style={{ fontWeight: 700 }}>Two-factor sign-in is always on</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.55 }}>
            Every account is asked to set it up, and it cannot be turned off — not for one account and not for all
            of them. There is nothing to configure here.
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailSettingsTab() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [form, setForm] = useState(null);
  const [password, setPassword] = useState('');
  // Prefilled with your own address: it's where a test almost always goes, and
  // it means the buttons aren't disabled the moment the tab opens.
  const [testTo, setTestTo] = useState(me?.email || '');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);

  const testToValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(testTo.trim());

  function load() {
    api.get('/admin/email-settings').then((res) => {
      setForm(res.data);
      setTestTo(res.data.user || '');
    });
  }
  useEffect(load, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/admin/email-settings', {
        host: form.host,
        port: Number(form.port),
        secure: form.secure,
        user: form.user,
        from: form.from,
        ...(password ? { password } : {}),
      });
      setPassword('');
      toast('Email server settings saved', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const res = await api.post('/admin/email-settings/test', testTo ? { to: testTo } : {});
      toast(`Test email sent to ${res.data.to}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTesting(false);
    }
  }

  // Walks the whole chain and shows where it stops. "It didn't arrive" has
  // several causes and the send error on its own rarely says which.
  async function onDiagnose() {
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const res = await api.post('/admin/email-settings/diagnose', testTo ? { to: testTo } : {});
      setDiagnosis(res.data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDiagnosing(false);
    }
  }

  if (form === null) return <SkeletonList rows={4} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '-8px 0 0' }}>
        These settings control the SMTP server used to send login verification codes and other account emails.
      </p>

      <form onSubmit={onSave} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 3, fontSize: 13, fontWeight: 600 }}>
            SMTP host
            <input
              className="input"
              style={{ marginTop: 6, width: '100%' }}
              placeholder="smtp.example.com"
              value={form.host || ''}
              onChange={(e) => update('host', e.target.value)}
            />
          </label>
          <label style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            Port
            <input
              className="input"
              style={{ marginTop: 6, width: '100%' }}
              placeholder="587"
              value={form.port || ''}
              onChange={(e) => update('port', e.target.value)}
            />
          </label>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!form.secure} onChange={(e) => update('secure', e.target.checked)} />
          Use TLS/SSL (secure connection)
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            SMTP username
            <input
              className="input"
              style={{ marginTop: 6, width: '100%' }}
              value={form.user || ''}
              onChange={(e) => update('user', e.target.value)}
            />
          </label>
          <label style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            SMTP password
            <input
              className="input"
              type="password"
              style={{ marginTop: 6, width: '100%' }}
              placeholder={form.hasPassword ? '••••••••  (leave blank to keep current)' : ''}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600 }}>
          From address
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="Taxify <taxify@mikesapphub.com>"
            value={form.from || ''}
            onChange={(e) => update('from', e.target.value)}
          />
          <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--text-muted)' }}>
            Must contain a real address. A name on its own leaves the envelope sender empty, and the mail arrives
            as MAILER-DAEMON. Use the mailbox your SMTP username can send as.
          </span>
        </label>

        <div>
          <button className="btn btn-primary" disabled={busy} type="submit">
            Save
          </button>
        </div>
      </form>

      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Send a test email</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Sends a test message using the settings above (save first if you just changed them).
          {testTo && !testToValid && (
            <span style={{ color: 'var(--red)' }}> Enter a valid email address to enable these.</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            type="email"
            style={{ flex: 1 }}
            placeholder="you@example.com"
            value={testTo}
            // Addresses are case-insensitive and stored lower case everywhere
            // else, so the field matches rather than quietly differing.
            onChange={(e) => setTestTo(e.target.value.toLowerCase())}
          />
          <button className="btn btn-ghost" disabled={testing || !testToValid} onClick={onTest}>
            {testing ? 'Sending…' : 'Send test'}
          </button>
          <button className="btn btn-ghost" disabled={diagnosing || !testToValid} onClick={onDiagnose}>
            {diagnosing ? 'Checking…' : 'Diagnose'}
          </button>
        </div>

        {diagnosis && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {diagnosis.checks.map((c) => (
                <div key={c.step} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13 }}>
                  <Icon
                    name={c.ok ? 'check-circle' : 'alert'}
                    size={15}
                    style={{ color: c.ok ? 'var(--emerald)' : 'var(--red)', marginTop: 1, flexShrink: 0 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.step}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: c.ok ? 'var(--text-muted)' : 'var(--red)',
                        fontFamily: c.ok ? 'inherit' : 'Consolas, monospace',
                        wordBreak: 'break-word',
                      }}
                    >
                      {c.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <details style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <summary style={{ cursor: 'pointer' }}>Settings in use</summary>
              <div style={{ fontFamily: 'Consolas, monospace', marginTop: 6, lineHeight: 1.7 }}>
                <div>host: {diagnosis.config.host || '—'}</div>
                <div>port: {diagnosis.config.port}</div>
                <div>secure: {String(diagnosis.config.secure)}</div>
                <div>user: {diagnosis.config.user || '(none)'}</div>
                <div>password: {diagnosis.config.hasPassword ? 'set' : 'NOT SET'}</div>
                <div>from: {diagnosis.config.from || '—'}</div>
                <div>envelope from: {diagnosis.config.envelopeFrom || '—'}</div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function StripeModeSection({ label, hint, section, values, secretDraft, onFieldChange, onSecretChange, onTest, testing }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{hint}</div>
      </div>

      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Publishable key
        <input
          className="input"
          style={{ marginTop: 6, width: '100%' }}
          placeholder={section === 'test' ? 'pk_test_...' : 'pk_live_...'}
          value={values.publishableKey || ''}
          onChange={(e) => onFieldChange(section, 'publishableKey', e.target.value)}
        />
      </label>

      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Secret key
        <input
          className="input"
          type="password"
          style={{ marginTop: 6, width: '100%' }}
          placeholder={values.hasSecretKey ? '••••••••  (leave blank to keep current)' : section === 'test' ? 'sk_test_...' : 'sk_live_...'}
          value={secretDraft || ''}
          onChange={(e) => onSecretChange(section, e.target.value)}
        />
      </label>

      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Webhook signing secret
        <input
          className="input"
          style={{ marginTop: 6, width: '100%' }}
          placeholder="whsec_..."
          value={values.webhookSecret || ''}
          onChange={(e) => onFieldChange(section, 'webhookSecret', e.target.value)}
        />
      </label>

      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          Individual plan price ID
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="price_..."
            value={values.priceIndividual || ''}
            onChange={(e) => onFieldChange(section, 'priceIndividual', e.target.value)}
          />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          Small Business plan price ID
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="price_..."
            value={values.priceBusiness ?? values.priceFamily ?? ''}
            onChange={(e) => onFieldChange(section, 'priceBusiness', e.target.value)}
          />
        </label>
      </div>

      {/* One-time prices, for paying a year outright.
          Optional: leave them empty and customers only ever subscribe, which
          is how this behaved before. Stripe will not sell a recurring price in
          payment mode, so these have to be separate price objects — create them
          as one-off prices on the same products. */}
      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          Individual — pay once price ID
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="price_… (optional)"
            value={values.priceIndividualOnce || ''}
            onChange={(e) => onFieldChange(section, 'priceIndividualOnce', e.target.value)}
          />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          Small Business — pay once price ID
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="price_… (optional)"
            value={values.priceBusinessOnce || ''}
            onChange={(e) => onFieldChange(section, 'priceBusinessOnce', e.target.value)}
          />
        </label>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
        Leave the pay-once fields empty and everybody subscribes, exactly as before. Fill them in and customers are
        asked which they would rather do — one payment for the year, or a subscription that renews itself. They must
        be <strong>one-time</strong> prices; Stripe refuses to sell a recurring price outright.
      </p>

      <div>
        <button className="btn btn-ghost" disabled={testing} onClick={() => onTest(section)} type="button">
          {testing ? 'Testing…' : `Test ${section} connection`}
        </button>
      </div>
    </div>
  );
}

function StripeSettingsTab() {
  const confirm = useConfirm();
  // Locked on every visit, never remembered — a lock that stays open is a
  // decoration.
  const [unlocked, setUnlocked] = useState(false);

  const toast = useToast();
  const [mode, setMode] = useState(null);
  const [live, setLive] = useState({});
  const [test, setTest] = useState({});
  const [liveSecret, setLiveSecret] = useState('');
  const [testSecret, setTestSecret] = useState('');

  // Asked before it is switched, because this is the difference between taking
  // somebody's money and pretending to. Nothing about the screen tells you
  // which one a click is about to choose until after it has chosen.
  async function confirmMode(next) {
    if (next === mode) return;
    const ok = await confirm(
      next === 'live'
        ? {
            tone: 'danger',
            title: 'Switch to LIVE mode?',
            body: 'Checkout, the billing portal and webhooks will use your live keys, and customers will be charged real money.',
            confirmLabel: 'Go live',
          }
        : {
            title: 'Switch to TEST mode?',
            body: 'Checkout and webhooks will use your test keys. Real cards stop working and nobody can subscribe until you switch back.',
            confirmLabel: 'Switch to test',
          }
    );
    if (ok) setMode(next);
  }
  const [busy, setBusy] = useState(false);
  const [testingMode, setTestingMode] = useState(null);

  function load() {
    api.get('/admin/stripe-settings').then((res) => {
      setMode(res.data.mode);
      setLive(res.data.live);
      setTest(res.data.test);
    });
  }
  useEffect(load, []);

  function onFieldChange(section, field, value) {
    const setter = section === 'test' ? setTest : setLive;
    setter((f) => ({ ...f, [field]: value }));
  }

  function onSecretChange(section, value) {
    if (section === 'test') setTestSecret(value);
    else setLiveSecret(value);
  }

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/admin/stripe-settings', {
        mode,
        live: {
          publishableKey: live.publishableKey,
          webhookSecret: live.webhookSecret,
          priceIndividual: live.priceIndividual,
          priceBusiness: live.priceBusiness,
          priceFamily: live.priceFamily,
          ...(liveSecret ? { secretKey: liveSecret } : {}),
        },
        test: {
          publishableKey: test.publishableKey,
          webhookSecret: test.webhookSecret,
          priceIndividual: test.priceIndividual,
          priceBusiness: test.priceBusiness,
          priceFamily: test.priceFamily,
          ...(testSecret ? { secretKey: testSecret } : {}),
        },
      });
      setLiveSecret('');
      setTestSecret('');
      toast('Stripe settings saved', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onTest(section) {
    setTestingMode(section);
    try {
      const res = await api.post('/admin/stripe-settings/test', { mode: section });
      toast(`Connected to Stripe (${res.data.mode} mode)`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTestingMode(null);
    }
  }

  if (mode === null) return <SkeletonList rows={4} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '-8px 0 0' }}>
        These keys connect Taxify to Stripe for subscription checkout, billing portal, and webhooks. Keep separate
        live and test credentials here, then flip the active mode to try out plans with Stripe's test cards without
        touching real payments.
      </p>

      {/* First, because it is the thing most likely to be wrong and the
          hardest to notice. Everything below is a key you either pasted or
          did not. */}
      <WebhookHealth />

      <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700 }}>Active mode</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {mode === 'test'
              ? 'Test mode is live — checkout, portal, and webhooks use your test credentials.'
              : 'Live mode is active — checkout, portal, and webhooks use your live credentials.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={mode === 'live' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => confirmMode('live')}
          >
            Live
          </button>
          <button
            type="button"
            className={mode === 'test' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => confirmMode('test')}
          >
            Test
          </button>
        </div>
      </div>

      {/* Locked until asked for. These are the keys that take real money, and
          they sit on a tab somebody opens to read a price id. Read it freely;
          changing it takes one deliberate act first. */}
      <div
        className="card"
        style={{
          padding: '13px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          borderLeft: `3px solid ${unlocked ? 'var(--amber)' : 'var(--border-strong)'}`,
        }}
      >
        <Icon name={unlocked ? 'pencil' : 'lock'} size={16} style={{ color: unlocked ? 'var(--amber)' : 'var(--text-muted)' }} />
        <span style={{ fontSize: 13, flex: 1, minWidth: 200, color: 'var(--text-muted)' }}>
          {unlocked
            ? 'Unlocked — changes here take effect for real payments as soon as they are saved.'
            : 'Locked. Unlock to change any of these keys.'}
        </span>
        <button
          type="button"
          className={unlocked ? 'btn btn-ghost' : 'btn btn-primary'}
          style={{ fontSize: 12.5 }}
          onClick={() => setUnlocked((v) => !v)}
        >
          {unlocked ? 'Lock' : 'Unlock to edit'}
        </button>
      </div>

      <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <fieldset disabled={!unlocked} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16, opacity: unlocked ? 1 : 0.6 }}>
        <StripeModeSection
          label="Live credentials"
          hint="Used for real customer payments when Active mode is set to Live."
          section="live"
          values={live}
          secretDraft={liveSecret}
          onFieldChange={onFieldChange}
          onSecretChange={onSecretChange}
          onTest={onTest}
          testing={testingMode === 'live'}
        />
        <StripeModeSection
          label="Test credentials"
          hint="Used with Stripe's test cards when Active mode is set to Test — nothing here touches real money."
          section="test"
          values={test}
          secretDraft={testSecret}
          onFieldChange={onFieldChange}
          onSecretChange={onSecretChange}
          onTest={onTest}
          testing={testingMode === 'test'}
        />

        <div>
          <button className="btn btn-primary" disabled={busy || !unlocked} type="submit">
            Save
          </button>
        </div>
        </fieldset>
      </form>
    </div>
  );
}

// Two lists, each saying exactly what a new set of books starts with.
//
// There was a third — "every set of books" — for the handful that belong on
// either. Tidy as a data model and poor as a screen: it meant the answer to
// "what does a new business start with" was the union of two sections rather
// than one of them, and an administrator had to do the addition themselves.
// The shared rows were split across both lists once, so there is nothing left
// to add up.
const GROUPS = [
  { id: 'individual', label: 'Personal books', hint: 'what a personal set of books starts with' },
  { id: 'business', label: 'Business books', hint: 'what a new business starts with' },
];

function DefaultCategoriesTab() {
  const toast = useToast();
  const [categories, setCategories] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [icon, setIcon] = useState('tag');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(SWATCHES[0]);
  const [editIcon, setEditIcon] = useState('tag');

  // Which list is being added to and looked at.
  //
  // Both existed before and only one of them was reachable: this table fed an
  // account's first set of books, while a hard-coded pair fed every book made
  // afterwards. Editing here changed nothing about the rest, and there was
  // nothing on screen to say so.
  const [kind, setKind] = useState('individual');
  const [editKind, setEditKind] = useState('individual');

  // A name clashes with the list being added to, plus the shared one — the
  // same rule the unique key enforces, asked here so the answer arrives before
  // the press rather than as a refusal after it.
  // One list, so one question: does this name already exist on the list being
  // added to.
  const existingNames = (categories || []).filter((c) => c.kind === kind).map((c) => c.name);
  const nameError = categoryNameError(name, existingNames);
  const nameReady = isCategoryNameReady(name, existingNames);
  const editNameError = categoryNameError(editName, existingNames, categories?.find((c) => c.id === editingId)?.name);

  function load() {
    api.get('/admin/default-categories').then((res) => setCategories(res.data.categories));
  }
  useEffect(load, []);

  async function onAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/default-categories', { name, color, icon, kind });
      setName('');
      setIcon('tag');
      toast('Default category added — new signups will get it', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(id) {
    setBusy(true);
    try {
      await api.patch(`/admin/default-categories/${id}`, {
        name: editName,
        color: editColor,
        icon: editIcon,
        kind: editKind,
      });
      setEditingId(null);
      toast('Default category updated', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/admin/default-categories/${id}`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -12, marginBottom: 20, lineHeight: 1.6 }}>
        The starter set every <strong>new set of books</strong> is created with, filed against the financial year it is
        made in. Personal and business books start from different lists; a category marked as being for both appears
        on either. Changes here only affect books made afterwards — an existing set is its own, and carries forward
        into each new year on its own.
      </p>

      <form onSubmit={onAdd} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <CategoryPreview icon={icon} color={color} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="label">Name</label>
            <input
              className="input"
              placeholder="New Default Category Name"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(tidyCategoryName(e.target.value))}
              aria-invalid={nameError ? 'true' : undefined}
              style={nameError ? { borderColor: 'var(--red)' } : undefined}
            />
            <div
              style={{
                fontSize: 11.5,
                marginTop: 5,
                minHeight: 15,
                color: nameError ? 'var(--red)' : 'var(--text-muted)',
              }}
            >
              {nameError || `${MIN_NAME_LENGTH}–${MAX_NAME_LENGTH} characters`}
            </div>
          </div>
          <ColourPicker value={color} onChange={setColor} />
        </div>

        <IconPicker value={icon} onChange={setIcon} />

        {/* Which list this one goes on. On the form, because it is a
            property of the category being added rather than of the page —
            a tab at the top made it look like a filter while quietly
            deciding this as well. */}
        <div>
          <label className="label">Added to</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {GROUPS.map((g) => {
              const on = kind === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setKind(g.id)}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: '7px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: on ? '#fff' : 'var(--text-muted)',
                    background: on ? 'var(--accent)' : 'var(--bg-card)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy || !nameReady} type="submit" style={{ alignSelf: 'flex-start' }}>
          {busy && <span className="spinner" />}
          Add default category
        </button>
      </form>

      {/* All three groups at once, rather than one at a time.

          They were tabs, which meant looking at the personal list hid the
          business one — and the question an administrator actually has is
          usually about the difference between them. Comparing two lists by
          clicking back and forth is not comparing them. */}
      {categories === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {GROUPS.map((group) => {
            const rows = categories.filter((c) => (c.kind || 'both') === group.id);
            return (
              <div key={group.id}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{group.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{group.hint}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                    {rows.length} {rows.length === 1 ? 'category' : 'categories'}
                  </span>
                </div>

                {rows.length === 0 ? (
                  <div
                    style={{
                      padding: 18,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px dashed var(--border)',
                      fontSize: 12.5,
                      color: 'var(--text-muted)',
                    }}
                  >
                    Nothing here yet.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                    <AnimatePresence initial={false}>
                      {rows.map((c) => {
              const editing = editingId === c.id;
              return (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="card"
                  style={{
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    gridColumn: editing ? '1 / -1' : 'auto',
                    borderLeft: `4px solid ${editing ? editColor : c.color}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                    <CategoryPreview icon={editing ? editIcon : c.icon} color={editing ? editColor : c.color} size={48} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editing ? (
                        <input className="input" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} />
                      ) : (
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                      )}
                    </div>
                    {!editing && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 12.5, padding: '7px 12px', gap: 6 }}
                          onClick={() => {
                            setEditingId(c.id);
                            setEditName(c.name);
                            setEditColor(c.color);
                            setEditIcon(c.icon || 'tag');
                            // Carried in, so saving an edit does not move a
                            // shared default onto one list by omission.
                            setEditKind(c.kind || 'both');
                          }}
                        >
                          <Icon name="pencil" size={14} />
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost icon-btn"
                          title={`Delete ${c.name}`}
                          onClick={() => onDelete(c.id)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    )}
                  </div>

                  {editing && (
                    <>
                      <ColourPicker value={editColor} onChange={setEditColor} />
                      <IconPicker value={editIcon} onChange={setEditIcon} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 13 }}
                          disabled={busy || !editName.trim()}
                          onClick={() => onSaveEdit(c.id)}
                        >
                          {busy && <span className="spinner" />}
                          Save
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </motion.div>
              );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
