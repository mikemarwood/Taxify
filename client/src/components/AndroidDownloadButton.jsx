import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AndroidDownloadButton() {
  const [version, setVersion] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/app/version')
      .then((res) => {
        if (!cancelled) setVersion(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const href = version ? `/downloads/taxify.apk?v=${version.versionCode}` : '/downloads/taxify.apk';

  return (
    <a
      href={href}
      download
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 20px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, #8b5cf6, #6366f1 50%, #06b6d4)',
        color: '#fff',
        fontWeight: 700,
        fontSize: 14,
        textDecoration: 'none',
        boxShadow: '0 4px 16px rgba(99, 102, 241, 0.35)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.45)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(99, 102, 241, 0.35)';
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.6 9.48l1.84-3.18a.42.42 0 00-.73-.42l-1.86 3.23a11.05 11.05 0 00-9.7 0L5.29 5.88a.42.42 0 00-.73.42L6.4 9.48A10.6 10.6 0 001 18h22a10.6 10.6 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 111.25-1.25A1.25 1.25 0 017 15.25zm10 0a1.25 1.25 0 111.25-1.25A1.25 1.25 0 0117 15.25z" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, alignItems: 'flex-start' }}>
        <span>Download for Android</span>
        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
          {version?.versionName ? `v${version.versionName} · always latest` : 'APK · always latest'}
        </span>
      </span>
    </a>
  );
}
