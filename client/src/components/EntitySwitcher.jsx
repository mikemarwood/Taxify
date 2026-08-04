import { useEffect, useRef, useState } from 'react';
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
  const { entities, selected, entity, isAll, showSwitcher, choose } = useEntities();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

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

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="card"
            style={{
              position: 'absolute',
              top: '108%',
              left: 0,
              right: 0,
              minWidth: 220,
              padding: 5,
              zIndex: 1300,
              maxHeight: 340,
              overflowY: 'auto',
            }}
          >
            {entities.map((e) => (
              <Row
                key={e.id}
                icon={e.kind === 'business' ? 'briefcase' : 'user'}
                title={e.name}
                subtitle={`${e.cadence === 'quarterly' ? 'Lodges quarterly' : 'Lodges yearly'} · ${e.counts?.expenses ?? 0} expense${e.counts?.expenses === 1 ? '' : 's'}`}
                active={String(selected) === String(e.id)}
                onClick={() => pick(e.id)}
              />
            ))}

            <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />

            <Row
              icon="list"
              title="Everything"
              subtitle="Every set of books together"
              active={isAll}
              onClick={() => pick(ALL_ENTITIES)}
            />
            <Row
              icon="settings"
              title="Manage in Categories"
              onClick={() => {
                setOpen(false);
                navigate('/categories');
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
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
