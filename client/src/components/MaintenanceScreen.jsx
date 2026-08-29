import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';

// What everybody except an admin sees while the site is deliberately off.
//
// Built on the same ground as StartupScreen so the app does not appear to have
// been replaced by a different website — same gradient, same mark, same type.
// Somebody arriving here has been interrupted mid-task and the first thing
// they need is to recognise where they are.
//
// The two things it has to do beyond that: say which kind of offline this is,
// because a planned window and a fault leave you in different positions; and
// give a way back that is not "keep reloading the page and hope".

const REASON_MARK = {
  maintenance: (
    // Spanner. Work is being done, by somebody, on purpose.
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0 5.1 5.1l-8.3 8.3a2.4 2.4 0 0 1-3.4-3.4z" />
      <path d="M14.7 6.3 17 4a4 4 0 0 1 3 6.9" />
    </svg>
  ),
  technical: (
    // A warning triangle, not a broken-plug or a sad face. Something is wrong
    // and is known about; that is all it should convey.
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.2" />
      <path d="M12 17.2h.01" />
    </svg>
  ),
};

export default function MaintenanceScreen({ notice, onCleared }) {
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState(false);

  const reason = notice?.reason === 'technical' ? 'technical' : 'maintenance';

  // Ask the server whether it is back, rather than making them reload.
  //
  // A reload during an outage is a coin toss: the app shell is a static file
  // and will happily load, then hit the same closed door and land straight
  // back here. Asking the one endpoint that stays up is a definite answer.
  async function checkAgain() {
    setChecking(true);
    setStillDown(false);
    try {
      const { data } = await api.get('/maintenance');
      if (data?.maintenance) setStillDown(true);
      else onCleared?.();
    } catch {
      // Unreachable rather than deliberately off. Same message either way from
      // where the reader is sitting: not yet.
      setStillDown(true);
    } finally {
      setChecking(false);
    }
  }

  // And check on our own every half minute, so somebody who leaves the tab
  // open comes back to a working app instead of to this.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get('/maintenance');
        if (!data?.maintenance) onCleared?.();
      } catch {
        // Still down, or still unreachable. Nothing to say; the next tick will
        // ask again.
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [onCleared]);

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '32px 24px calc(32px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(180deg, #10294c 0%, #143257 55%, #0d2444 100%)',
        color: '#eaf1fb',
        textAlign: 'center',
      }}
    >
      {/* The name beside the mark, not implied by it.
          
          A lone icon on a dark screen with no navigation and no address bar
          worth reading is a page that does not say whose it is — and this is
          exactly the page somebody lands on when they are already unsure
          whether the problem is them or us. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <img
          src="/logo.svg"
          alt=""
          width="52"
          height="52"
          style={{ borderRadius: 11, boxShadow: '0 12px 34px -12px rgba(0, 0, 0, .6)' }}
        />
        <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.6 }}>Taxify</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}
      >
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 58,
            height: 58,
            borderRadius: '50%',
            background: 'rgba(255,255,255,.08)',
            border: '1px solid rgba(255,255,255,.16)',
            color: reason === 'technical' ? '#ffc46b' : '#8fc0ff',
          }}
        >
          {REASON_MARK[reason]}
        </span>

        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.3 }}>
          {notice?.heading || 'Taxify is temporarily unavailable'}
        </h1>

        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: 'rgba(234,241,251,.8)' }}>
          {notice?.body || 'We will be back shortly. Nothing you have saved is affected.'}
        </p>

        <button
          type="button"
          onClick={checkAgain}
          disabled={checking}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            marginTop: 4,
            padding: '11px 22px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,.22)',
            background: checking ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.14)',
            color: '#fff',
            font: 'inherit',
            fontSize: 14,
            fontWeight: 600,
            cursor: checking ? 'default' : 'pointer',
          }}
        >
          {checking && <span className="spinner" />}
          {checking ? 'Checking' : 'Check again'}
        </button>

        {/* Only after they have asked. Saying "still down" before anybody
            pressed anything is answering a question nobody put. */}
        {stillDown && !checking && (
          <span style={{ fontSize: 13, color: 'rgba(234,241,251,.6)' }}>
            Still down. This page checks by itself every half a minute, so you can leave it open.
          </span>
        )}
      </motion.div>
    </div>
  );
}
