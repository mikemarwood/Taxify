import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { fileVerb } from '../lib/taxWords.js';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useEntities, ALL_ENTITIES } from '../lib/EntityContext.jsx';
import Icon from './Icon.jsx';
import { playClick } from '../lib/sounds.js';

// Which books you are in, and how to change them.
//
// Hidden entirely when there is only one set — a picker with one option is
// noise, and it means an account that has never created a business sees nothing
// new at all.

export default function EntitySwitcher({ compact = false }) {
  const { user } = useAuth();
  // "Lodges" in Australia and New Zealand, "Files" everywhere else.
  const filesWord = fileVerb(user?.country) === 'lodge' ? 'Lodges' : 'Files';
  const { entities, selected, entity, isAll, showSwitcher, choose } = useEntities();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClickOutside(e) {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Measured off the button, because the list is drawn outside the sidebar —
  // which scrolls, and therefore clips anything that reaches past its edge. On
  // a phone that meant the list was cut off the moment it opened.
  //
  // Above the `showSwitcher` return, and it has to stay there. Both of these
  // are hooks, and hooks have to run in the same order on every render. Below
  // that return they ran only once entities had loaded — four hooks on the
  // first render, six on the next — which is React error #310, and it took the
  // whole page down because Layout renders this outside any boundary.
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    const margin = 8;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    setAnchor({ left, width, top: r.bottom + 6, maxHeight: Math.max(160, window.innerHeight - r.bottom - 24) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  if (!showSwitcher) return null;

  const label = isAll ? 'Everything' : entity?.name || 'Choose books';
  const kindIcon = isAll ? 'list' : entity?.kind === 'business' ? 'briefcase' : 'user';

  function pick(id) {
    playClick();
    choose(id);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: compact ? '6px 10px' : '9px 11px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--nav-border)',
          background: 'rgba(255, 255, 255, 0.06)',
          color: 'var(--nav-text-active)',
          cursor: 'pointer',
          fontSize: compact ? 12.5 : 13,
          fontWeight: 600,
          textAlign: 'left',
          minWidth: 0,
        }}
      >
        <Icon name={kindIcon} size={15} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <Icon name="chevron-down" size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && anchor && (
            <motion.div
              ref={panelRef}
              role="listbox"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="card"
              style={{
                position: 'fixed',
                top: anchor.top,
                left: anchor.left,
                width: anchor.width,
                padding: 5,
                zIndex: 1300,
                maxHeight: Math.min(340, anchor.maxHeight),
                overflowY: 'auto',
              }}
            >
            {entities.map((e) => (
              <Row
                key={e.id}
                icon={e.kind === 'business' ? 'briefcase' : 'user'}
                title={e.name}
                subtitle={`${filesWord} ${e.cadence === 'quarterly' ? 'quarterly' : 'yearly'} · ${e.counts?.expenses ?? 0} expense${e.counts?.expenses === 1 ? '' : 's'}`}
                active={String(selected) === String(e.id)}
                onClick={() => pick(e.id)}
              />
            ))}


              {/* Only when there is more than one thing to see at once. With a
                  single set of books this is the same view under a second name,
                  and offering it only invites the question of what differs. */}
              {entities.length > 1 && (
                <Row
                  icon="list"
                  title="Everything"
                  subtitle="Every set of books together"
                  active={isAll}
                  onClick={() => pick(ALL_ENTITIES)}
                />
              )}

              {/* This is where somebody is already thinking about their books, so
                  it is where 'and I want another one' occurs to them. The row
                  that used to be here pointed at the Categories page, which was
                  never a sensible place for it. */}
              <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />
              <Row
                icon="book"
                title="Manage your books"
                onClick={() => {
                  setOpen(false);
                  navigate('/books');
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function Row({ icon, title, subtitle, active, onClick }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={!!active}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: 'var(--text)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={15} style={{ flexShrink: 0, color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</span>
        )}
      </span>
      {active && <Icon name="check" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
    </button>
  );
}
