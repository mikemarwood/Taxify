import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import ViewAsBanner from './ViewAsBanner.jsx';
import ClientBanner from './ClientBanner.jsx';
import AppUpdateBanner from './AppUpdateBanner.jsx';
import NotificationBell from './NotificationBell.jsx';
import EntitySwitcher from './EntitySwitcher.jsx';
import { registerForPush } from '../lib/pushNotifications.js';
import OtpOnboardingModal from './OtpOnboardingModal.jsx';
import { playClick } from '../lib/sounds.js';
import { formatMoney } from '../lib/money.js';
import { describeSubscription } from '../lib/subscription.js';
import { currentPlanType, planLabel as labelForPlan } from '../lib/plans.js';
import SiteFooter from './SiteFooter.jsx';
import { useKeyboardOpen } from '../lib/useKeyboardOpen.js';

// Eight equal-weight links in one column give no sense of where anything is.
// Grouping them under headings means the eye lands on a section first and a
// link second, which is how people actually look for "where do I add a receipt".
const navGroups = [
  {
    title: null,
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/reports', label: 'Reports', icon: 'chart' },
    ],
  },
  {
    title: 'Expenses',
    items: [
      { to: '/add', label: 'Add expense', icon: 'plus-circle' },
      // Kilometres and hours are the claims that arrive without a receipt, so
      // this belongs beside adding one rather than three items further down
      // where it read as an unrelated page. Indented, because it is the same
      // job done a different way.
      { to: '/deductions', label: 'Other deductions', icon: 'car', sub: true },
      { to: '/expenses', label: 'All expenses', icon: 'list' },
      { to: '/categories', label: 'Categories', icon: 'tag' },
    ],
  },
  {
    title: 'Settings',
    items: [
      // Structural rather than a preference: which sets of books exist decides
      // where every expense, report and lodgement in the app belongs. It lived
      // above the Categories page's own title until it earned this.
      { to: '/books', label: 'Your books', icon: 'book' },
      { to: '/account', label: 'My account', icon: 'settings' },
      { to: '/support', label: 'Support', icon: 'mail' },
    ],
    adminItems: [{ to: '/admin', label: 'Administration', icon: 'wrench' }],
    // Only for someone who actually acts for clients — a way back to the
    // picker that sits with the rest of the navigation rather than only
    // appearing in the banner once a client is already open.
    accountantItems: [{ to: '/clients', label: 'My clients', icon: 'briefcase' }],
  },
];

// Inside a client's books an accountant is here to look, not to file — the
// links they can't use are left out rather than shown and rejected.
const ACCOUNTANT_PATHS = ['/', '/expenses', '/reports', '/account'];

function NavItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={playClick}
      className="nav-item"
      style={({ isActive }) => ({
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        // A sub-item sits in from its parent and rides slightly smaller, so
        // the pair reads as one thing with two ways in.
        padding: item.sub ? '7px 12px 7px 26px' : '8px 12px',
        borderRadius: 'var(--radius-sm)',
        fontSize: item.sub ? 13 : 13.5,
        fontWeight: isActive ? 600 : 500,
        textDecoration: 'none',
        color: isActive ? 'var(--nav-text-active)' : 'var(--nav-text)',
        background: isActive ? 'var(--nav-active-bg)' : 'transparent',
      })}
    >
      {({ isActive }) => (
        <>
          {/* Fluent marks the selected item with an accent pill on the leading
              edge rather than filling the whole row. */}
          {isActive && (
            <motion.span
              layoutId="nav-indicator"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                translateY: '-50%',
                width: 3,
                height: 16,
                borderRadius: 999,
                background: 'var(--nav-accent)',
              }}
            />
          )}
          {/* The elbow that ties it to the item above. Purely decorative, so
              it is hidden from anyone listening rather than read out. */}
          {item.sub && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 13,
                top: 0,
                bottom: '50%',
                width: 9,
                borderLeft: '1px solid var(--nav-border)',
                borderBottom: '1px solid var(--nav-border)',
                borderBottomLeftRadius: 6,
                opacity: 0.8,
              }}
            />
          )}
          <Icon name={item.icon} size={item.sub ? 17 : 19} strokeWidth={isActive ? 2 : 1.8} style={{ color: isActive ? "var(--nav-accent)" : "inherit" }} />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [showMfaPrompt, setShowMfaPrompt] = useState(false);
  // The drawer, on small screens only. Closed on every navigation, or it would
  // stay over the page someone just asked for.
  const [navOpen, setNavOpen] = useState(false);
  // With the keyboard up every row counts, and the bar is the one row that is
  // pure decoration once you are typing.
  const keyboardOpen = useKeyboardOpen();
  const billing = describeSubscription(user);

  useEffect(() => {
    if (user) registerForPush();
  }, [user]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    // Not while an accountant is already being told the same thing on the
    // client picker. That prompt offers "Not now" and this requirement does
    // not, and two versions of one ask — one dismissible, one not — reads as a
    // bug rather than as insistence.
    const accountantMustAnyway = user?.accountantSetup && !user.accountantSetup.ready;
    if (user?.mfaPromptDue && !accountantMustAnyway) {
      const id = setTimeout(() => setShowMfaPrompt(true), 800);
      return () => clearTimeout(id);
    }
  }, [user?.mfaPromptDue, user?.accountantSetup?.ready]);

  useEffect(() => {
    api
      .get('/expenses/auto-generated/unnotified')
      .then((res) => {
        const list = res.data.expenses;
        if (list.length === 1) {
          toast(`Auto-added recurring expense: ${list[0].itemName} (${formatMoney(list[0].amount)})`, 'info');
        } else if (list.length > 1) {
          toast(`${list.length} recurring expenses were added automatically`, 'info');
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppUpdateBanner />
      <ViewAsBanner />
      <ClientBanner />

      {/* Only on small screens, where the rail is a drawer rather than a
          column. Without it there would be no way to reach the navigation. */}
      <div
        className="app-topbar"
        style={{
          display: 'none',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: 'var(--nav-bg)',
          color: 'var(--nav-text-active)',
          borderBottom: '1px solid var(--nav-border)',
          position: 'sticky',
          top: 0,
          zIndex: 1100,
        }}
      >
        <button
          type="button"
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 38,
            height: 38,
            borderRadius: 9,
            border: '1px solid var(--nav-border)',
            background: 'rgba(255, 255, 255, 0.08)',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          <Icon name={navOpen ? 'x' : 'menu'} size={19} />
        </button>
        {!keyboardOpen && (
          <>
            <img src="/logo.svg" alt="" width="26" height="26" />
            <span style={{ fontWeight: 700, fontSize: 16.5, letterSpacing: -0.3 }}>Taxify</span>
          </>
        )}
        <div style={{ marginLeft: 'auto', maxWidth: 190, minWidth: 0 }}>
          <EntitySwitcher compact />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* Tapping the dimmed content closes the drawer — the gesture everyone
          already expects. */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(16, 24, 40, 0.5)', zIndex: 1150 }}
        />
      )}
      <aside
        className="scrollbar-slim app-sidebar"
        data-open={navOpen ? 'true' : 'false'}
        style={{
          width: 232,
          flexShrink: 0,
          // A dark rail against light content: the chrome recedes and the
          // numbers stay the brightest thing on screen.
          background: 'var(--nav-bg)',
          color: 'var(--nav-text)',
          borderRight: '1px solid var(--nav-border)',
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          position: 'sticky',
          top: 0,
          height: '100vh',
          // The rail is a fixed-height column, so anything taller than the
          // screen was simply clipped — and on a phone that was the account
          // card at the bottom, which is where Log out lives. `scrollbar-slim`
          // only styles a scrollbar; it never made one appear.
          overflowY: 'auto',
        }}
      >
        <div className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <img src="/logo.svg" alt="Taxify" width="34" height="34" />
          <span style={{ fontWeight: 700, fontSize: 19, letterSpacing: -0.4, color: 'var(--nav-text-active)' }}>Taxify</span>
        </div>

        {/* A scope control for everything below it, so it sits above the nav
            rather than in the account card at the foot. Hidden on a phone,
            where the bar across the top already carries one — two of the same
            control on one screen is most of what made the drawer feel busy. */}
        <div className="nav-scope">
          <EntitySwitcher />
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {navGroups
            .map((group) => {
              const items = [
                ...group.items,
                ...(user?.isAdmin ? group.adminItems || [] : []),
                ...(user?.isAccountant ? group.accountantItems || [] : []),
              ].filter(
                // Inside a client, or invited only as an accountant, the pages
                // that write to books are simply not offered.
                (i) =>
                  i.to === '/clients' ||
                  !(user?.actingAsClient || user?.role === 'accountant') ||
                  ACCOUNTANT_PATHS.includes(i.to)
              );
              return { ...group, items };
            })
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.title || 'main'} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {group.title && (
                  <div
                    className="nav-group-title"
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: 0.7,
                      textTransform: 'uppercase',
                      color: 'var(--nav-text)',
                      opacity: 0.55,
                      padding: '0 12px',
                      marginBottom: 3,
                    }}
                  >
                    {group.title}
                  </div>
                )}
                {group.items.map((item) => (
                  <NavItem key={item.to} item={item} />
                ))}
              </div>
            ))}
        </nav>

        {/* Pinned to the foot of the rail rather than sitting at the end of it.
            On a phone the nav is taller than the screen, so scrolling alone
            would still leave Log out somewhere below several groups of links.
            The nav scrolls underneath this; it never leaves. */}
        <div
          style={{
            marginTop: 'auto',
            position: 'sticky',
            bottom: 0,
            background: 'var(--nav-bg)',
            paddingTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* One bordered block instead of loose rows: the avatar, who you are,
              which plan, and how long it lasts read as a single card rather
              than four things stacked at the bottom of the rail. */}
          <div
            style={{
              border: '1px solid var(--nav-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            <Link
              to="/account"
              title="Account settings"
              style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', minWidth: 0 }}
            >
              <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={32} />
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span
                  style={{
                    color: 'var(--nav-text-active)',
                    fontWeight: 600,
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user?.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--nav-text)',
                    opacity: 0.8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {/* Which hat, said plainly. Someone who keeps their own
                      books and does other people's needs to know which one
                      they are in before they read a single number. */}
                  {user?.actingAsClient
                    ? `Acting as accountant · ${user.actingAsClient.businessName || user.actingAsClient.name}`
                    : user?.role === 'owner'
                    ? `${labelForPlan(currentPlanType(user))} plan${
                        user.isAccountant ? ' · accountant' : ''
                      }`
                    : user?.role === 'accountant'
                    ? 'Accountant — no account of your own yet'
                    : 'Family member'}
                </span>
              </span>
            </Link>

            {/* Trial state belongs with the plan: which plan you're on is no
                use if you don't know it's about to stop. */}
            {user?.role === 'owner' && !user?.actingAsClient && (
              <Link
                to="/account?tab=billing"
                title={billing.detail}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  padding: '5px 8px',
                  borderRadius: 6,
                  color: billing.tone === 'bad' || billing.tone === 'warn' ? '#1a1200' : 'var(--nav-text-active)',
                  background:
                    billing.tone === 'bad'
                      ? 'var(--red)'
                      : billing.tone === 'warn'
                      ? 'var(--amber)'
                      : 'rgba(255, 255, 255, 0.07)',
                }}
              >
                <Icon name={billing.state === 'active' ? 'check-circle' : 'info'} size={13} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {billing.label}
                </span>
              </Link>
            )}
            {/* One row: the bell as an icon square, Log out taking the rest.
                Two equal text buttons never fit the rail's width — the labels
                overflowed their own boxes — and both are pressed rarely enough
                not to deserve as much of the drawer as the pages you go to. */}
            <div className="nav-foot-actions">
              <NotificationBell compact />

              <button
                className="btn nav-btn"
                style={{ fontSize: 13, gap: 7 }}
                onClick={async () => {
                  playClick();
                  await logout();
                  navigate('/login');
                }}
              >
                <Icon name="log-out" size={15} />
                Log out
              </button>
            </div>
          </div>

          <div className="nav-footer">
            <SiteFooter tone="nav" align="left" style={{ padding: '4px 8px 0' }} />
          </div>
        </div>
      </aside>

      {/* Keyed on the router's location, not window's, so the entrance
          actually replays on every navigation. Fluent page transitions come
          in from below and settle quickly — long enough to read as motion,
          short enough not to sit between you and the data. */}
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="app-shell-main"
        style={{ flex: 1, padding: '32px 40px', maxWidth: 1180, minWidth: 0 }}
      >
        {children}
      </motion.main>

      {location.pathname !== '/add' && user?.role !== 'accountant' && !user?.actingAsClient && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.15 }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          className="app-fab"
          style={{ position: 'fixed', right: 32, bottom: 32, zIndex: 900 }}
        >
          <Link
            to="/add"
            title="Add expense"
            onClick={playClick}
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent)',
              color: 'white',
              textDecoration: 'none',
              boxShadow: '0 4px 10px rgba(16, 24, 40, 0.14), 0 12px 28px rgba(0, 103, 192, 0.22)',
            }}
          >
            <Icon name="plus" size={24} strokeWidth={2.2} />
          </Link>
        </motion.div>
      )}

      {showMfaPrompt && <OtpOnboardingModal onClose={() => setShowMfaPrompt(false)} />}
      </div>
    </div>
  );
}
