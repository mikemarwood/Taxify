import { useEffect, useRef, useState } from 'react';
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

export default function NotificationBell() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

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
        style={{ fontSize: 13, position: 'relative', width: '100%', justifyContent: 'center', gap: 8 }}
      >
        <Icon name="bell" size={15} />
        Notifications
        {unread > 0 && (
          <span
            style={{
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 999,
              background: 'var(--red)',
              color: '#fff',
              fontSize: 10.5,
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="card"
            style={{
              position: 'absolute',
              bottom: '112%',
              left: 0,
              right: 0,
              minWidth: 260,
              maxHeight: 380,
              overflowY: 'auto',
              padding: 0,
              zIndex: 1300,
            }}
          >
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
      </AnimatePresence>
    </div>
  );
}
