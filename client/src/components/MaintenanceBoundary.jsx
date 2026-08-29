import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, setMaintenanceHandler } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import MaintenanceScreen from './MaintenanceScreen.jsx';

// Stands between the app and everybody who is not an admin while the site is
// deliberately off.
//
// Two ways it finds out, and it needs both.
//
// Asking at startup is what makes the outage visible to somebody who arrives
// during it: /auth/me is on the server's allow list, so a signed-in account
// resolves normally and would otherwise reach a working-looking app that fails
// on its first real request.
//
// Listening for a 503 is what makes it visible to somebody who was already
// working when the switch was thrown. That is the "kick them off" half: they
// do not have to reload to find out, the next thing they touch tells them.
export default function MaintenanceBoundary({ children }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [notice, setNotice] = useState(null);

  // Support counts. Somebody staffing the outage needs to be able to read the
  // tickets that arrive because of it.
  const staff = Boolean(user?.isAdmin || user?.isSupport);

  useEffect(() => {
    setMaintenanceHandler((next) => setNotice(next));
    return () => setMaintenanceHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/maintenance')
      .then(({ data }) => {
        if (!cancelled) setNotice(data?.maintenance || null);
      })
      .catch(() => {
        // Cannot tell. Assume the site is up: showing an outage notice because
        // one request failed would be its own outage.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cleared = useCallback(() => setNotice(null), []);

  // Sign-ups being shut is the other switch that is invisible from the inside.
  //
  // It is set once, in a panel nobody opens daily, and then the site looks
  // perfectly normal to everybody who already has an account — including the
  // person who closed them. Weeks of no new customers is not a thing to
  // discover from the figures.
  //
  // Admins only, not support staff: whether the shop is open is a decision
  // only an administrator can make or unmake, and a bar about a switch you
  // cannot reach is noise.
  const [signupsShut, setSignupsShut] = useState(false);
  useEffect(() => {
    if (!user?.isAdmin) return undefined;
    let cancelled = false;
    api
      .get('/auth/signup-options')
      .then(({ data }) => {
        if (!cancelled) setSignupsShut(data?.registrationEnabled === false);
      })
      .catch(() => {
        // Same reasoning as above: a failed request is not evidence of
        // anything, and a wrong banner is worse than no banner.
      });
    return () => {
      cancelled = true;
    };
  }, [user?.isAdmin]);

  // The sign-in page always renders.
  //
  // Otherwise this is a way to lock yourself out of your own site: the switch
  // is in the admin panel, the admin panel needs a session, and a session needs
  // this page. Login shows the notice as a banner instead — see LoginNotice.
  if (notice && !staff && pathname !== '/login') {
    return <MaintenanceScreen notice={notice} onCleared={cleared} />;
  }

  return (
    <>
      {/* Staff get the app and a standing reminder, because the single worst
          outcome here is leaving the site switched off and not realising. It
          looks normal from the inside — an admin is never refused. */}
      {notice && staff && (
        <StateBar
          tone={notice.reason === 'technical' ? '#8a4b00' : '#123a6b'}
          text={`Site off for everyone but you — ${
            notice.reason === 'technical' ? 'technical difficulties' : 'maintenance'
          }`}
        />
      )}

      {signupsShut && <StateBar tone="#6b3b12" text="Sign-ups are closed — nobody new can create an account" />}

      {children}
    </>
  );
}

// One line, and small enough to be one line on a phone.
//
// It carried a "Turn it back on" link, which was the wrong shape for a
// standing reminder: it sat beside the sentence competing for the same row, so
// on a narrow screen the bar wrapped to two lines and took a chunk out of a
// viewport that had none to spare. The switch is one tap away in Settings and
// is a decision, not something to put a shortcut to in a bar somebody reads
// twenty times a day.
//
// Not sticky. It was, so that an administrator could not forget — but a bar
// pinned to the top of the viewport slides over whatever scrolls under it, and
// on the admin page that is the heading and the View Server button beside it.
// A banner that hides a control is a worse failure than one that scrolls away.
function StateBar({ tone, text }) {
  return (
    <div
      role="status"
      style={{
        position: 'relative',
        zIndex: 2500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // One line, cut short rather than wrapped. Two lines of banner on a
        // phone is a tenth of the screen spent saying something the reader
        // already knows.
        gap: 8,
        padding: '5px 12px',
        background: tone,
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'center',
        lineHeight: 1.35,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {/* Titled as well as truncated, so the half a narrow screen cuts off is
          still readable rather than merely gone. */}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={text}>
        {text}
      </span>
    </div>
  );
}

// The banner on the sign-in page while the site is off.
//
// Its own small component rather than part of the screen above, because login
// is the one page that stays open during an outage and it should say why it is
// the only thing working — not pretend nothing is happening.
export function MaintenanceLoginNotice() {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/maintenance')
      .then(({ data }) => {
        if (!cancelled) setNotice(data?.maintenance || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice) return null;

  return (
    <div
      role="status"
      style={{
        marginBottom: 16,
        padding: '12px 14px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 3 }}>{notice.heading}</strong>
      <span style={{ color: 'var(--text-muted)' }}>{notice.body}</span>
    </div>
  );
}
