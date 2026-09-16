import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';

// Keeping the Android app current.
//
// Two halves of the app update very differently, and it is worth being clear
// about which is which:
//
//   The screens, the logic, every fix — those live on the server and the app
//   loads them fresh on every launch. That half genuinely always updates, with
//   nothing to install.
//
//   The native shell around them only changes when the APK is replaced. Android
//   will not let an app installed outside the Play Store silently overwrite
//   itself; the person has to approve the install. So this offers it rather
//   than doing it behind their back, which is also the honest thing.
//
// There is only ever one APK on the server. `versionCode` in app-version.json
// is what says whether the running build is behind it.

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DISMISSED_KEY = 'taxify:updateDismissedFor';

// Capacitor appends this in capacitor.config.json, so the app can recognise
// itself. A browser never matches and never sees any of this.
function installedVersionCode() {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (!/TaxifyAndroid/i.test(ua)) return null;
  // `TaxifyAndroid/3` once the build number is appended; a bare marker is
  // treated as version 1, which is what shipped before this existed.
  const match = /TaxifyAndroid\/(\d+)/i.exec(ua);
  return match ? Number(match[1]) : 1;
}

export default function AppUpdateBanner() {
  const [update, setUpdate] = useState(null);
  const installed = installedVersionCode();

  useEffect(() => {
    if (installed === null) return undefined;

    function check() {
      api
        .get('/app/version')
        .then((res) => {
          const latest = Number(res.data?.versionCode);
          if (!Number.isFinite(latest) || latest <= installed) return setUpdate(null);
          // Declining an update should last until there is a newer one, not
          // until the next launch.
          if (String(localStorage.getItem(DISMISSED_KEY)) === String(latest)) return setUpdate(null);
          setUpdate({ ...res.data, versionCode: latest });
        })
        .catch(() => {});
    }

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [installed]);

  if (!update) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -60 }}
        animate={{ y: 0 }}
        exit={{ y: -60 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="app-banner"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1600,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: '10px 16px',
          background: 'linear-gradient(90deg, #1559b8, #1e6ad4)',
          color: '#fff',
          boxShadow: '0 2px 10px rgba(16, 24, 40, .25)',
        }}
      >
        <Icon name="download" size={17} />
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>
          Version {update.versionName} is ready
        </span>
        <span style={{ fontSize: 12.5, flex: 1, minWidth: 180, opacity: 0.9 }}>
          {update.notes || 'Tap update to install the newest version of the app.'}
        </span>

        <a
          href={`/downloads/taxify.apk?v=${update.versionCode}`}
          download
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 15px',
            borderRadius: 'var(--radius-sm)',
            background: '#fff',
            color: '#1559b8',
            fontSize: 12.5,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Update now
        </a>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, String(update.versionCode));
            setUpdate(null);
          }}
          style={{
            background: 'rgba(255, 255, 255, .16)',
            border: 0,
            color: '#fff',
            fontSize: 12.5,
            fontWeight: 600,
            padding: '7px 13px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          Later
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
