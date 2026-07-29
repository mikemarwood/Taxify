import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export default function ExportMenu({ baseUrl, label = 'Export' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="download" size={15} />
        {label}
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            padding: 6,
            minWidth: 160,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <a
            href={`${baseUrl}.xlsx`}
            onClick={() => setOpen(false)}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            className="export-menu-item"
          >
            <Icon name="chart" size={14} />
            Excel (.xlsx)
          </a>
          <a
            href={`${baseUrl}.pdf`}
            onClick={() => setOpen(false)}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            className="export-menu-item"
          >
            <Icon name="file-text" size={14} />
            PDF (.pdf)
          </a>
        </div>
      )}
    </div>
  );
}
