import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import ArchiveProgress from './ArchiveProgress.jsx';
import { useYearArchive } from '../lib/useYearArchive.js';

const itemStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
  color: 'var(--text)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'none',
  border: 0,
  width: '100%',
  textAlign: 'left',
  cursor: 'pointer',
};

export default function ExportMenu({ baseUrl, label = 'Export', archiveYear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const archive = useYearArchive();

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
        {archive.busy ? <span className="spinner" /> : <Icon name="download" size={15} />}
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
            minWidth: archiveYear ? 260 : 160,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <a href={`${baseUrl}.xlsx`} onClick={() => setOpen(false)} style={itemStyle} className="export-menu-item">
            <Icon name="chart" size={14} />
            Excel (.xlsx)
          </a>
          <a href={`${baseUrl}.pdf`} onClick={() => setOpen(false)} style={itemStyle} className="export-menu-item">
            <Icon name="file-text" size={14} />
            PDF (.pdf)
          </a>

          {/* The full archive belongs in the same menu as the other exports —
              that is where anyone looking for "download everything" looks
              first, and it stays open so the progress can be watched. */}
          {archiveYear && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
              <button
                type="button"
                className="export-menu-item"
                style={{ ...itemStyle, opacity: archive.busy ? 0.6 : 1 }}
                disabled={archive.busy}
                onClick={() => archive.start(archiveYear)}
              >
                <Icon name="folder" size={14} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span>Everything for {archiveYear} (.zip)</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>
                    Summary + every receipt, in folders
                  </span>
                </span>
              </button>
              <div style={{ padding: '0 8px 4px' }}>
                <ArchiveProgress archive={archive} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
