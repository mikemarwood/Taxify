import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { formatDateTime } from '../lib/dates.js';

// Everything the app has told you, still here.
//
// It used to raise a toast and forget — three and a half seconds, and if you
// were making a coffee you never knew a recurring expense had been added. This
// keeps them, and the Android app pushes the same messages to the notification
// tray so they arrive even when the app is closed.

const POLL_MS = 2 * 60 * 1000;

// `compact` is the sidebar footer: an icon-only square beside Log out, rather
// than two equal slabs of text competing for a row that is already narrow.
export default function NotificationBell({ compact = false }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  // Where to draw the panel, in viewport coordinates.
  const [anchor, setAnchor] = useState(null);

  function load() {
    api
      .get('/notifications')
      .then((res) => setData(res.data))
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Measured from the button rather than positioned relative to it, because
  // the panel is drawn outside the sidebar now — see the portal below.
  const place = useCallback(() => {
    const button = ref.current;
    if (!button) return;
    const r = button.getBoundingClientRect();
    const width = Math.max(r.width, 300);
    const margin = 8;
    // Kept on screen. Anchored to the button's left edge normally, pulled back
    // when that would push it off the right of a narrow window.
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    setAnchor({ left, width, bottom: window.innerHeight - r.top + 8 });
  }, []);

  // Before paint, so it never shows up in the wrong place for a frame.
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    // The sidebar scrolls, and the button moves with it.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const [clearing, setClearing] = useState(false);
  const unread = data?.unread || 0;
  const items = data?.notifications || [];

  async function openPanel() {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      // Opening it is reading it. Marked optimistically so the badge clears
      // immediately rather than on the next poll.
      setData((d) => ({ ...d, unread: 0, notifications: d.notifications.map((n) => ({ ...n, read: true })) }));
      await api.post('/notifications/read', {}).catch(() => {});
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn nav-btn"
        onClick={openPanel}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        style={{
          fontSize: 13,
          position: 'relative',
          width: '100%',
          justifyContent: 'center',
          gap: compact ? 0 : 8,
          // Clipped only when there is a label to clip. That label can grow
          // wider than the button and, being centred, spill out of both edges —
          // which is how a bell ended up floating outside its own box.
          //
          // Compact has no label and does have a count pinned to its corner, so
          // hiding the overflow there cuts the corner off the badge instead.
          overflow: compact ? 'visible' : 'hidden',
          padding: compact ? 0 : undefined,
        }}
      >
        <Icon name="bell" size={15} />
        {!compact && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Notifications</span>}
        {unread > 0 && (
          <span
            style={{
              minWidth: compact ? 16 : 18,
              height: compact ? 16 : 18,
              padding: '0 5px',
              borderRadius: 999,
              background: 'var(--red)',
              color: '#fff',
              fontSize: 10.5,
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              // Pinned to the corner when there's no label to sit beside.
              ...(compact
                ? { position: 'absolute', top: -5, right: -5, border: '2px solid var(--nav-bg)' }
                : null),
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Rendered into the body, not into the sidebar.

          The sidebar scrolls, which makes it a clipping context: a panel wider
          than the sidebar was cut off at its edge, and one taller than the
          remaining space was cut off at the bottom. No z-index fixes that —
          the only fix is to not be inside it. */}
      {createPortal(
        <AnimatePresence>
          {open && anchor && (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="card"
              style={{
                position: 'fixed',
                left: anchor.left,
                bottom: anchor.bottom,
                width: anchor.width,
                // Never taller than the space above the button.
                maxHeight: `min(380px, calc(100vh - ${anchor.bottom}px - 16px))`,
                overflowY: 'auto',
                padding: 0,
                zIndex: 1300,
              }}
            >
            {/* A way to empty it.
                Marking everything read clears the badge and leaves the list
                full, so a panel somebody has finished with keeps growing until
                it stops being worth opening. Only shown when there is
                something to clear. */}
            {items.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--bg-card)',
                  zIndex: 1,
                }}
              >
                <button
                  type="button"
                  disabled={clearing}
                  onClick={async () => {
                    setClearing(true);
                    try {
                      await api.delete('/notifications');
                      setData({ unread: 0, notifications: [] });
                    } catch {
                      // Nothing useful to say inside a dropdown that is about
                      // to close. The list reloads on the next poll either way.
                    } finally {
                      setClearing(false);
                    }
                  }}
                  style={{
                    border: 0,
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                  }}
                >
                  {clearing ? 'Clearing…' : 'Clear all'}
                </button>
              </div>
            )}

            {items.length === 0 ? (
              <div style={{ padding: 22, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
                Nothing yet. Recurring expenses, accountant access and tax reminders will appear here.
              </div>
            ) : (
              items.map((n, i) => {
                const inner = (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{n.title}</div>
                    {n.body && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{n.body}</div>
                    )}
                    <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 4 }}>
                      {formatDateTime(n.createdAt)}
                    </div>
                  </>
                );
                const style = {
                  display: 'block',
                  padding: '11px 14px',
                  borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
                  textDecoration: 'none',
                  color: 'var(--text)',
                  background: n.read ? 'transparent' : 'var(--accent-soft)',
                };
                return n.url ? (
                  <Link key={n.id} to={n.url} onClick={() => setOpen(false)} style={style}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id} style={style}>
                    {inner}
                  </div>
                );
              })
            )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
