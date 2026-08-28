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
import { sentenceCaseLive, titleCaseLive } from '../lib/textCase.js';
import { onCasedInput } from '../lib/casedInput.js';
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
import ViewServer from '../components/ViewServer.jsx';
import BroadcastTab from '../components/BroadcastTab.jsx';
import { planLabel } from '../lib/plans.js';
import { autoFocusFields } from '../lib/device.js';


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
      { key: 'broadcast', label: 'Email everyone', icon: 'mail' },
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
  const [serverView, setServerView] = useState(false);

  // Kept in the URL, so the tab survives a refresh and can be linked to.
  function setTab(next) {
    setTabState(next);
    setSearchParams(next === 'stats' ? {} : { tab: next }, { replace: true });
  }

  if (serverView) return <ViewServer onClose={() => setServerView(false)} />;

  return (
    <div style={{ maxWidth: tab === 'stats' || tab === 'support' || tab === 'how' ? 1100 : 760 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Administration</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>
            Manage user accounts and the default category template.
          </p>
        </div>
        {/* The wall display. Not a tab, because it is full-screen and meant to
            be cast or left on a spare monitor rather than read inside the
            panel — a tab would put the site's own navigation around something
            designed to be looked at from across a room. */}
        {!supportOnly && (
          <button className="btn btn-ghost" style={{ fontSize: 13, gap: 7 }} onClick={() => setServerView(true)}>
            <Icon name="chart" size={15} />
            View Server
          </button>
        )}
      </div>

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
                      // No `font` shorthand. It resets every font property it
                      // does not name, so sitting here it threw away both the
                      // size and the weight two lines above — fontFamily was
                      // already doing the only job it was wanted for.
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
      {tab === 'broadcast' && <BroadcastTab />}
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

  // Keeps itself up to date, so somebody watching this list sees an account
  // appear rather than finding out by pressing refresh.
  //
  // Fifteen seconds, and paused while a detail panel is open: reloading the
  // list under an open panel is how a half-read screen changes under somebody
  // — and the panel holds its own copy of the account anyway, so refreshing
  // behind it would achieve nothing except making the row jump.
  //
  // Paused too when the tab is hidden. A wall of admin screens left open
  // overnight should not be a query every fifteen seconds each until morning.
  useEffect(() => {
    if (detailId) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      api
        .get('/admin/users')
        .then((res) => setUsers(res.data.users))
        .catch(() => {
          // A failed poll leaves the list as it was. Replacing a working
          // screen with an error because one request missed is worse than
          // showing figures fifteen seconds old.
        });
    }, 15000);
    return () => clearInterval(timer);
  }, [detailId]);
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
                        like anybody else.

                        Accountants used to be the exception, on the grounds
                        that they genuinely had no plan. That stopped being
                        true when any account could become an accountant while
                        keeping its own books: the sidebar says "Small Business
                        plan · Accountant" and this list said "Accountant",
                        so the same person's plan read differently depending on
                        which screen you were looking at. The rule here is now
                        the sidebar's rule — an accountant who holds a plan is
                        shown on it, and one who holds none still shows only
                        the role. */}
                    {(u.isAdmin || u.isSupport || (u.role === 'accountant' && u.planType)) && (
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
  const confirm = useConfirm();
  const [registrationEnabled, setRegistrationEnabled] = useState(null);
  const [mfaMode, setMfaMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);

  // Taking the site offline. Kept in its own state rather than folded into the
  // toggle above, because it is the one setting on this page that changes what
  // everybody else can do right now.
  const [maint, setMaint] = useState(null);
  const [maintBusy, setMaintBusy] = useState(false);

  // The wording and the reason are a draft until Save is pressed.
  //
  // They used to write on blur and on every chip click, which meant a
  // half-typed sentence could be sitting in front of locked-out customers the
  // moment attention wandered to another tab. `saved` is what is actually
  // stored, so the card can tell whether there is anything to save.
  const [draft, setDraft] = useState({ reason: 'maintenance', message: '' });
  const [saved, setSaved] = useState({ reason: 'maintenance', message: '' });

  useEffect(() => {
    api.get('/admin/settings').then((res) => {
      setRegistrationEnabled(res.data.registrationEnabled);
      setMfaMode(res.data.mfaMode);
      setMaint({
        enabled: res.data.maintenanceEnabled,
        stock: res.data.maintenanceStock,
      });
      const stored = { reason: res.data.maintenanceReason, message: res.data.maintenanceMessage || '' };
      setDraft(stored);
      setSaved(stored);
    });
  }, []);

  const maintDirty = draft.reason !== saved.reason || draft.message.trim() !== saved.message.trim();

  // Writes the wording only. The switch has its own path below, because one is
  // a note somebody is drafting and the other takes the site away from every
  // customer using it — they should not share a button.
  async function saveMaintenanceWording() {
    setMaintBusy(true);
    try {
      await api.patch('/admin/settings', {
        maintenanceReason: draft.reason,
        maintenanceMessage: draft.message.trim(),
      });
      setSaved({ reason: draft.reason, message: draft.message.trim() });
      toast(maint.enabled ? 'Notice updated — visitors see it now' : 'Notice saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMaintBusy(false);
    }
  }

  // Turning the site off, or bringing it back.
  //
  // Confirmed both ways, and this is not ceremony for its own sake. Off is the
  // most destructive switch in the panel — every customer mid-task is stopped
  // where they stand — and on is worth confirming too, because it is normally
  // pressed in a hurry and it reopens the site to everybody the instant it
  // lands. The dialog states what actually happens rather than asking "are you
  // sure", which is a question nobody has ever answered no to on information
  // they did not have.
  async function setSiteOffline(next) {
    const reason = draft.reason === 'technical' ? 'technical difficulties' : 'maintenance';
    const wording = draft.message.trim();

    const ok = await confirm(
      next
        ? {
            title: 'Take Taxify offline for everyone?',
            body:
              `Every customer using the site right now is stopped where they are and shown the ${reason} notice ` +
              `on their next action — including anyone part-way through adding an expense.\n\n` +
              (wording ? `They will be told: “${wording}”\n\n` : '') +
              'You and support staff keep working as normal, and the sign-in page stays open so you can get back in ' +
              'and switch this off again.',
            confirmLabel: 'Take the site offline',
            tone: 'danger',
          }
        : {
            title: 'Put Taxify back online?',
            body:
              'The notice comes down and everybody can use the site again straight away. Anyone sitting on the ' +
              'notice page is let back in within half a minute without having to reload.',
            confirmLabel: 'Bring it back online',
          }
    );
    if (!ok) return;

    setMaintBusy(true);
    try {
      // The wording goes with it, so switching off never shows the previous
      // notice while an unsaved new one sits in the box.
      await api.patch('/admin/settings', {
        maintenanceEnabled: next,
        maintenanceReason: draft.reason,
        maintenanceMessage: wording,
      });
      setMaint((prev) => ({ ...prev, enabled: next }));
      setSaved({ reason: draft.reason, message: wording });
      toast(next ? 'The site is now offline for everyone but staff' : 'The site is back online', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMaintBusy(false);
    }
  }

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

  if (registrationEnabled === null || mfaMode === null || maint === null) return <SkeletonList rows={2} />;

  const stock = maint.stock?.[draft.reason] || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* First on the page, and red when it is on.

          Everything else here changes what somebody can do next time; this one
          changes what everybody can do right now. It is also the setting most
          easily left on by accident, so it says loudly when it is. */}
      <div
        className="card"
        style={{
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          borderColor: maint.enabled ? 'var(--red)' : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Take the site offline</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {maint.enabled
                ? 'The site is off. Everyone signed in has been shown the notice; only admins and support can use it.'
                : 'Everyone can use Taxify normally. Turning this on shows a notice instead — admins and support keep working, and the sign-in page stays open so you can turn it back on.'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={maint.enabled}
            aria-label="Take the site offline"
            disabled={maintBusy}
            onClick={() => setSiteOffline(!maint.enabled)}
            style={{
              flexShrink: 0,
              width: 52,
              height: 30,
              padding: 3,
              borderRadius: 999,
              border: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: maint.enabled ? 'flex-end' : 'flex-start',
              background: maint.enabled ? 'var(--red)' : 'var(--border-strong)',
              cursor: maintBusy ? 'default' : 'pointer',
              opacity: maintBusy ? 0.6 : 1,
              transition: 'background .18s ease',
            }}
          >
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#fff' }} />
          </button>
        </div>

        {/* Which kind of offline. Planned work and a fault leave the reader in
            different positions and are worth saying apart — that is the whole
            reason there is a choice here rather than one generic notice. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { key: 'maintenance', label: 'Undergoing maintenance' },
            { key: 'technical', label: 'Technical difficulties' },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={maintBusy}
              onClick={() => setDraft((d) => ({ ...d, reason: option.key }))}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: maintBusy ? 'default' : 'pointer',
                border: `1px solid ${draft.reason === option.key ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: draft.reason === option.key ? 'var(--accent-soft)' : 'var(--bg-inset)',
                color: draft.reason === option.key ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="maintenance-message">
            What to tell people (optional)
          </label>
          {/* Sentence capitals as it is typed, the same as every other prose
              box in the app. sentenceCaseLive never changes the string's
              length, so the caret stays where the typist left it, and it
              leaves whitespace alone — which is what makes a blank line
              between two paragraphs possible in a textarea. */}
          <textarea
            id="maintenance-message"
            className="input"
            rows={3}
            maxLength={400}
            value={draft.message}
            onChange={onCasedInput(sentenceCaseLive, (value) => setDraft((d) => ({ ...d, message: value })))}
            placeholder={stock.body || ''}
            style={{ resize: 'vertical', lineHeight: 1.6 }}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
            {/* The heading is never overridden, so say so rather than let
                somebody write a message that contradicts it. */}
            Shown under <strong>“{stock.heading}”</strong>. Leave it empty for the standard wording.
          </div>
        </div>

        {/* Saved on a button, never on blur.
            It wrote on every chip click and every time focus left the box,
            so a half-typed sentence could be sitting in front of locked-out
            customers the moment attention moved to another tab. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            disabled={!maintDirty || maintBusy}
            onClick={saveMaintenanceWording}
          >
            {maintBusy && <span className="spinner" />}
            Save notice
          </button>
          {maintDirty && (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {maint.enabled ? 'Not shown to anyone until you save' : 'Unsaved changes'}
            </span>
          )}
        </div>
      </div>

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

      <FacebookSettingsCard />
    </div>
  );
}

// The Facebook buttons at the foot of the landing page.
//
// Its own card rather than more state in SettingsTab: it has three fields and
// a save of its own, and the registration toggle saves on click.
function FacebookSettingsCard() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/settings').then((res) => {
      const next = {
        facebookEnabled: !!res.data.facebookEnabled,
        facebookShareUrl: res.data.facebookShareUrl || '',
        facebookPageUrl: res.data.facebookPageUrl || '',
      };
      setForm({ ...next, defaultShareUrl: res.data.defaultShareUrl || '' });
      setSaved(next);
    });
  }, []);

  if (!form) return null;

  const changed =
    saved &&
    (form.facebookEnabled !== saved.facebookEnabled ||
      form.facebookShareUrl.trim() !== saved.facebookShareUrl ||
      form.facebookPageUrl.trim() !== saved.facebookPageUrl);

  async function save() {
    const next = {
      facebookEnabled: form.facebookEnabled,
      facebookShareUrl: form.facebookShareUrl.trim(),
      facebookPageUrl: form.facebookPageUrl.trim(),
    };
    setBusy(true);
    try {
      await api.patch('/admin/settings', next);
      setSaved(next);
      toast(next.facebookEnabled ? 'Facebook buttons are on' : 'Facebook buttons are off', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontWeight: 700 }}>Facebook Like and Share</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.55 }}>
          Adds a Like button and a Share button to the foot of the landing page. Both are Facebook&rsquo;s own
          plugins, loaded without any script — the app hub strips scripts from that page, so the usual embed code
          would do nothing there. There is no tracking pixel and nothing to paste in.
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={form.facebookEnabled}
          onChange={(e) => setForm((f) => ({ ...f, facebookEnabled: e.target.checked }))}
        />
        Show the buttons on the landing page
      </label>

      <div>
        <label className="label">Address people share</label>
        <input
          className="input"
          value={form.facebookShareUrl}
          placeholder={form.defaultShareUrl || 'https://taxify.mikesapphub.com'}
          onChange={set('facebookShareUrl')}
        />
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
          Leave it empty to use {form.defaultShareUrl || 'the site address'}, which is almost always what you want.
        </div>
      </div>

      <div>
        <label className="label">Your Facebook page (optional)</label>
        <input
          className="input"
          value={form.facebookPageUrl}
          placeholder="https://www.facebook.com/yourpage"
          onChange={set('facebookPageUrl')}
        />
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
          Adds a &ldquo;Follow us&rdquo; link beside the other two. Left empty, no link appears.
        </div>
      </div>

      <div>
        <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy || !changed} onClick={save}>
          {busy && <span className="spinner" />}
          Save
        </button>
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
            <input autoComplete="current-password"
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
          <input autoComplete="email"
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
        <input autoComplete="current-password"
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
      // Tidied here, where trimming and collapsing runs of spaces is right.
      await api.post('/admin/default-categories', { name: tidyCategoryName(name), color, icon, kind });
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

  // Whether the edit form differs from the row it opened on. Compared against
  // the tidied name, so re-typing the same name with a stray trailing space
  // does not count as a change.
  function editDirty(row) {
    return (
      tidyCategoryName(editName) !== row.name ||
      editColor !== row.color ||
      editIcon !== (row.icon || 'tag') ||
      editKind !== (row.kind || 'both')
    );
  }

  async function onSaveEdit(id) {
    setBusy(true);
    try {
      await api.patch(`/admin/default-categories/${id}`, {
        name: tidyCategoryName(editName),
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
            {/* titleCaseLive, not tidyCategoryName.

                tidyCategoryName is titleCase, which trims and collapses
                whitespace — right on submit, ruinous per keystroke. The space
                between two words was deleted the instant it was typed, so
                "Office Supplies" could not be entered here at all. The live
                version only changes the case of characters already present,
                so the length never moves and neither does the caret. Submit
                still tidies properly. */}
            <input
              className="input"
              placeholder="New Default Category Name"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={onCasedInput(titleCaseLive, setName)}
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
                        <>
                          <input
                            className="input"
                            autoFocus={autoFocusFields}
                            maxLength={MAX_NAME_LENGTH}
                            value={editName}
                            onChange={onCasedInput(titleCaseLive, setEditName)}
                            aria-invalid={editNameError ? 'true' : undefined}
                            style={editNameError ? { borderColor: 'var(--red)' } : undefined}
                          />
                          {/* editNameError was already being calculated here
                              and thrown away, so renaming a default onto a
                              name that already existed looked fine until the
                              server refused it. */}
                          {editNameError && (
                            <div style={{ fontSize: 11.5, marginTop: 5, color: 'var(--red)' }}>{editNameError}</div>
                          )}
                        </>
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
                        {/* Nothing changed, nothing to save. A live Save on an
                            untouched form invites a write that does nothing
                            and a toast saying it worked. */}
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 13 }}
                          disabled={busy || !editName.trim() || Boolean(editNameError) || !editDirty(c)}
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
