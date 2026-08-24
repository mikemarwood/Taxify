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
        <div
          role="status"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '4px 10px',
            padding: '9px 16px',
            background: notice.reason === 'technical' ? '#8a4b00' : '#123a6b',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          <span>
            The site is switched off for everyone but you —{' '}
            {notice.reason === 'technical' ? 'technical difficulties' : 'maintenance'}.
          </span>
          <a href="/app/admin" style={{ color: '#fff', textDecoration: 'underline' }}>
            Turn it back on
          </a>
        </div>
      )}
      {children}
    </>
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
