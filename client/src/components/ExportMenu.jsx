import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import ArchiveProgress from './ArchiveProgress.jsx';
import { useYearArchive } from '../lib/useYearArchive.js';
import { downloadsWork } from '../lib/canDownload.js';

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
  // An <a href> cannot set a header, so the download carries the books it is
  // for in the query string instead. The routes refuse to guess: an accountant
  // handed a file labelled for one business that quietly held all of them is
  // the worst outcome available here.
  const { selectedId } = useEntities();
  const scoped = (url) => (selectedId ? `${url}?entityId=${selectedId}` : url);
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
      {open && !downloadsWork() && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            padding: 14,
            width: 240,
            zIndex: 50,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'var(--text-muted)',
          }}
        >
          {/* This build of the app cannot save a file — see canDownload.js.
              Listing four exports that all do nothing is worse than saying so. */}
          Update the app to export. Everything here works in a browser in the
          meantime, signed in as usual.
        </div>
      )}
      {open && downloadsWork() && (
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
          <a href={scoped(`${baseUrl}.xlsx`)} onClick={() => setOpen(false)} style={itemStyle} className="export-menu-item">
            <Icon name="chart" size={14} />
            Excel (.xlsx)
          </a>
          <a href={scoped(`${baseUrl}.pdf`)} onClick={() => setOpen(false)} style={itemStyle} className="export-menu-item">
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
