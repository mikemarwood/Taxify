import { useEffect, useRef, useState } from 'react';

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
      <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setOpen((v) => !v)}>
        ⬇ {label}
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
            }}
            className="export-menu-item"
          >
            📊 Excel (.xlsx)
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
            }}
            className="export-menu-item"
          >
            📄 PDF (.pdf)
          </a>
        </div>
      )}
    </div>
  );
}
