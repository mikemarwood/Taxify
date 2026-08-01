import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
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
    }
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

  return (
    <div
      className="card"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 480,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <span
          style={{
            width: 48,
            height: 48,
            borderRadius: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1f6f3f, #3ddc84)',
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {ANDROID_MARK}
        </span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>Taxify for Android</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {[version?.versionName ? `Version ${version.versionName}` : null, size, updated ? `updated ${updated}` : null]
              .filter(Boolean)
              .join(' · ') || 'Free download'}
          </div>
        </div>
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {[
          ['camera', 'Photograph a receipt the moment you get it, straight from your phone'],
          ['lock', 'Your account, your receipts — the same data as the website, instantly'],
          ['download', 'Free with your subscription. No extra cost, no separate account'],
        ].map(([icon, text]) => (
          <li key={text} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--emerald)', marginTop: 1, flexShrink: 0 }}>
              <Icon name={icon} size={15} />
            </span>
            {text}
          </li>
        ))}
      </ul>

      {button}
      {notice}

      {/* Sideloaded rather than from Play, so the extra step is stated up front
          instead of being discovered as a scary warning mid-install. */}
      {!unavailable && (
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
          Installed directly rather than through the Play Store, so Android will ask you to allow it once. Requires
          Android 6.0 or newer.
        </p>
      )}
    </div>
  );
}
