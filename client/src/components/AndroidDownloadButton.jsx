import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { trackClick } from '../lib/analytics.js';
import Icon from './Icon.jsx';
import { formatDateShort } from '../lib/dates.js';

function formatSize(bytes) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return null;
  return formatDateShort(value, null);
}

// Whether this is the device the file will actually run on. An APK downloaded
// onto a laptop is inert, so telling someone that before they tap is kinder
// than letting them find out.
function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua);
}

function isInTaxifyApp() {
  if (typeof navigator === 'undefined') return false;
  return /TaxifyAndroid|capacitor/i.test(navigator.userAgent || '');
}

const ANDROID_MARK = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.6 9.48l1.84-3.18a.42.42 0 00-.73-.42l-1.86 3.23a11.05 11.05 0 00-9.7 0L5.29 5.88a.42.42 0 00-.73.42L6.4 9.48A10.6 10.6 0 001 18h22a10.6 10.6 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 111.25-1.25A1.25 1.25 0 017 15.25zm10 0a1.25 1.25 0 111.25-1.25A1.25 1.25 0 0117 15.25z" />
  </svg>
);

// The Android app, sold rather than merely linked. `variant="card"` is the full
// pitch for a landing page; the default is a single button for a sign-in page.
export default function AndroidDownloadButton({ variant = 'button' }) {
  const [version, setVersion] = useState(null);
  const [notAndroid, setNotAndroid] = useState(false);
  const [android] = useState(isAndroid);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/app/version')
      .then((res) => !cancelled && setVersion(res.data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Already inside the app — offering it the app is nonsense.
  if (isInTaxifyApp()) return null;

  // Cache-busted by version so a phone that downloaded an old build gets the
  // new one rather than whatever the browser kept.
  const href = version?.versionCode ? `/downloads/taxify.apk?v=${version.versionCode}` : '/downloads/taxify.apk';
  const size = formatSize(version?.sizeBytes);
  const updated = formatDate(version?.updatedAt);
  const unavailable = version && version.available === false;

  function onClick(e) {
    if (!android) {
      e.preventDefault();
      setNotAndroid(true);
      // Recorded separately, because it is a different thing to know: this is
      // somebody who wanted the app and could not have it, which is the
      // strongest signal there is for whether an iPhone build is worth
      // building.
      trackClick('download_apk_blocked', 'Not an Android device');
      return;
    }
    trackClick('download_apk', version?.versionName ? `Android ${version.versionName}` : 'Android');
  }

  const button = (
    <motion.a
      href={unavailable ? undefined : href}
      download={android ? true : undefined}
      onClick={onClick}
      whileHover={unavailable ? undefined : { y: -2 }}
      whileTap={unavailable ? undefined : { y: 0 }}
      aria-disabled={unavailable || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '13px 22px',
        borderRadius: 14,
        background: unavailable
          ? 'var(--bg-inset)'
          : 'linear-gradient(135deg, #1f6f3f 0%, #2f9e56 45%, #3ddc84 100%)',
        color: unavailable ? 'var(--text-muted)' : '#fff',
        fontWeight: 700,
        fontSize: 14.5,
        textDecoration: 'none',
        cursor: unavailable ? 'not-allowed' : 'pointer',
        boxShadow: unavailable ? 'none' : '0 6px 22px rgba(47, 158, 86, 0.35)',
        border: unavailable ? '1px solid var(--border)' : 'none',
      }}
    >
      {ANDROID_MARK}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, alignItems: 'flex-start' }}>
        <span>{unavailable ? 'Android app coming soon' : 'Get the Android app'}</span>
        <span style={{ fontSize: 11.5, fontWeight: 500, opacity: 0.9 }}>
          {unavailable
            ? 'Not published yet'
            : [version?.versionName ? `v${version.versionName}` : 'Latest version', size, 'Free'].filter(Boolean).join(' · ')}
        </span>
      </span>
    </motion.a>
  );

  const notice = (
    <AnimatePresence>
      {notAndroid && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            marginTop: 12,
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-inset)',
            border: '1px solid var(--border)',
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'var(--text-muted)',
            maxWidth: 420,
          }}
        >
          <Icon name="info" size={15} style={{ marginTop: 1, flexShrink: 0, color: 'var(--accent)' }} />
          <span>
            <strong style={{ color: 'var(--text)' }}>This app is for Android devices only.</strong> You're on a
            different device, so the file wouldn't run here. Open this page on your Android phone or tablet to install
            it — or just use Taxify in this browser, which does everything the app does.
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (variant === 'button') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        {button}
        {notice}
      </div>
    );
  }

  // The card is the pitch, so it is built like one: a coloured band that says
  // what it is at a glance, then the three things worth knowing, then the
  // download. It used to be a plain bordered box with a bullet list, which read
  // as a footnote next to the plan cards above it.
  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        width: '100%',
        maxWidth: 520,
        textAlign: 'left',
        // Android's own green, kept to the rim rather than filling the card, so
        // it identifies the thing without fighting the page's blue.
        border: '1px solid var(--border)',
        boxShadow: unavailable ? 'var(--shadow-sm)' : '0 18px 44px -22px rgba(47, 158, 86, 0.55)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '18px 22px',
          background: unavailable
            ? 'var(--bg-inset)'
            : 'linear-gradient(135deg, rgba(31, 111, 63, 0.22), rgba(61, 220, 132, 0.14))',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1f6f3f, #3ddc84)',
            color: '#fff',
            flexShrink: 0,
            boxShadow: '0 4px 14px rgba(47, 158, 86, 0.4)',
          }}
        >
          {ANDROID_MARK}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.25 }}>Taxify for Android</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {[version?.versionName ? `Version ${version.versionName}` : null, size, updated ? `updated ${updated}` : null]
              .filter(Boolean)
              .join(' · ') || 'Free download'}
          </div>
        </div>
        {!unavailable && (
          <span
            style={{
              marginLeft: 'auto',
              flexShrink: 0,
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              padding: '4px 9px',
              borderRadius: 999,
              color: '#3ddc84',
              background: 'rgba(61, 220, 132, 0.12)',
              border: '1px solid rgba(61, 220, 132, 0.3)',
            }}
          >
            Free
          </span>
        )}
      </div>

      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {[
            ['camera', 'Photograph a receipt the moment you get it', 'Straight from your phone, at the counter'],
            ['repeat', 'The same account, the same receipts', 'Everything you add here is on the website instantly'],
            ['lock', 'Included with your subscription', 'No extra cost and no second account to keep'],
          ].map(([icon, title, sub]) => (
            <li key={title} style={{ display: 'flex', gap: 11 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(61, 220, 132, 0.12)',
                  color: '#3ddc84',
                }}
              >
                <Icon name={icon} size={14} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{sub}</span>
              </span>
            </li>
          ))}
        </ul>

        {button}
        {notice}

        {/* Sideloaded rather than from Play, so the extra step is stated up
            front instead of being met as a scary warning mid-install. */}
        {!unavailable && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
            Installed directly rather than through the Play Store, so Android will ask you to allow it once. Requires
            Android 6.0 or newer.
          </p>
        )}
      </div>
    </div>
  );
}
