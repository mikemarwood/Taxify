import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import {
  MONTHS,
  WEEKDAYS,
  clampDay,
  daysInMonth,
  isOutOfRange,
  monthGrid,
  openingMonth,
  parseIso,
  shiftMonth,
  toIso,
  yearsBetween,
} from '../lib/calendar.js';
import { todayIso, formatDate } from '../lib/dates.js';

// One date field for the whole app, with the month and the year as lists.
//
// The browser's own picker is fine at "a day near today" and hopeless at
// anything else: the month steps one at a time and the year has no control of
// its own, so a date of birth means clicking an arrow four hundred times. That
// is the field somebody meets on the way in.
//
// So the month and the year are dropdowns, always, and the grid follows them.
// Two presses reach any month in the range instead of however many arrows lie
// between here and there.
//
// The value in and out is 'YYYY-MM-DD' — the same string <input type="date">
// gave, so nothing that reads it had to change. All the arithmetic is in
// calendar.js and is done on the three numbers rather than on a Date built
// from the string, which is where every "it saved the day before" bug lives.

// How far back a year list runs when the caller does not say.
//
// A hundred and twenty covers anybody alive; five ahead covers an invoice
// dated next year without offering a century nobody needs to scroll past.
const YEARS_BACK = 120;
const YEARS_AHEAD = 5;

export default function DateField({
  value,
  onChange,
  min = null,
  max = null,
  id,
  required = false,
  disabled = false,
  placeholder = 'Choose a date',
  className = 'input',
  style,
  // The years the dropdown offers. Given by the caller when it knows better
  // than the default — a date of birth wants a long list, an expense a short
  // one.
  yearFrom,
  yearTo,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const today = todayIso();
  const parsed = parseIso(value);

  const [view, setView] = useState(() => openingMonth(value, { min, max, today }));
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);
  const [anchor, setAnchor] = useState(null);

  // Reopened on the month the value is in, not on wherever it was left.
  useEffect(() => {
    if (open) setView(openingMonth(value, { min, max, today }));
    // Only when it opens: changing the month inside an open panel is the whole
    // point of it, and this would undo that on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const years = useMemo(() => {
    const from = yearFrom ?? (min ? Number(min.slice(0, 4)) : Number(today.slice(0, 4)) - YEARS_BACK);
    const to = yearTo ?? (max ? Number(max.slice(0, 4)) : Number(today.slice(0, 4)) + YEARS_AHEAD);
    // Newest first. Every list here is read from the recent end — this year's
    // expenses, this year's invoice — and a date of birth is the one case that
    // scrolls, which it would either way.
    return yearsBetween(from, to).reverse();
  }, [yearFrom, yearTo, min, max, today]);

  // Where to draw the panel. Portalled to the body so it is never clipped by a
  // modal's overflow or trapped under one — the expense modal and the trip
  // modal both scroll, and a panel inside them was cut off at the edge.
  const place = useCallback(() => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = 296;
    const height = 356;
    const room = window.innerHeight - box.bottom;
    setAnchor({
      left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
      // Above the field when there is no room below it, which on a phone with
      // the keyboard up is most of the time.
      top: room < height && box.top > height ? box.top - height - 6 : box.bottom + 6,
      width,
    });
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

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(iso) {
    onChange?.(iso);
    setOpen(false);
    buttonRef.current?.focus();
  }

  // Changing the month or year keeps the day where it can be kept. The 31st
  // with the month moved to February is the 28th, not the 3rd of March.
  function moveTo(year, month) {
    setView({ year, month });
    if (!parsed) return;
    const day = clampDay(year, month, parsed.day);
    const iso = toIso(year, month, day);
    if (!isOutOfRange(iso, min, max)) onChange?.(iso);
  }

  const grid = monthGrid(view.year, view.month);
  const canStepBack = !min || toIso(view.year, view.month, daysInMonth(view.year, view.month)) > min;
  const canStepOn = !max || toIso(view.year, view.month, 1) < max;

  const panel = open && anchor && (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Choose a date"
      style={{
        position: 'fixed',
        left: anchor.left,
        top: anchor.top,
        width: anchor.width,
        zIndex: 3400,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 22px 50px -18px rgba(9, 20, 40, .55)',
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Previous month"
          disabled={!canStepBack}
          style={{ padding: '5px 8px', lineHeight: 1 }}
          onClick={() => {
            const next = shiftMonth(view.year, view.month, -1);
            moveTo(next.year, next.month);
          }}
        >
          <Icon name="chevron-left" size={15} />
        </button>

        {/* The two controls the browser's picker never had. */}
        <select
          className="input"
          aria-label="Month"
          value={view.month}
          onChange={(e) => moveTo(view.year, Number(e.target.value))}
          style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 13 }}
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Year"
          value={view.year}
          onChange={(e) => moveTo(Number(e.target.value), view.month)}
          style={{ width: 82, padding: '6px 8px', fontSize: 13 }}
        >
          {/* The year in the value, even when it falls outside the offered
              range — an old record must not have its date silently rewritten
              by a list that cannot represent it. */}
          {(years.includes(view.year) ? years : [view.year, ...years]).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Next month"
          disabled={!canStepOn}
          style={{ padding: '5px 8px', lineHeight: 1 }}
          onClick={() => {
            const next = shiftMonth(view.year, view.month, 1);
            moveTo(next.year, next.month);
          }}
        >
          <Icon name="chevron-right" size={15} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            style={{
              textAlign: 'center',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.3,
              color: 'var(--text-subtle)',
              padding: '2px 0 4px',
            }}
          >
            {d.slice(0, 2)}
          </div>
        ))}

        {grid.map((cell, i) => {
          if (!cell) return <span key={`pad-${i}`} />;
          const chosen = value === cell.iso;
          const isToday = today === cell.iso;
          const blocked = isOutOfRange(cell.iso, min, max);
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={blocked}
              aria-current={chosen ? 'date' : undefined}
              onClick={() => pick(cell.iso)}
              style={{
                // Thirty-two is the smallest a day can be and still be hit
                // with a thumb.
                height: 32,
                borderRadius: 7,
                border: isToday && !chosen ? '1px solid var(--accent)' : '1px solid transparent',
                background: chosen ? 'var(--accent)' : 'transparent',
                color: chosen ? '#fff' : blocked ? 'var(--text-subtle)' : 'var(--text)',
                opacity: blocked ? 0.4 : 1,
                font: 'inherit',
                fontSize: 12.5,
                fontWeight: chosen ? 700 : 500,
                fontVariantNumeric: 'tabular-nums',
                cursor: blocked ? 'default' : 'pointer',
              }}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1, fontSize: 12.5, padding: '7px 10px' }}
          disabled={isOutOfRange(today, min, max)}
          onClick={() => pick(today)}
        >
          Today
        </button>
        {/* Only when there is something to clear, and never on a field that
            has to have a value. */}
        {value && !required && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ flex: 1, fontSize: 12.5, padding: '7px 10px' }}
            onClick={() => pick('')}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        className={className}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          cursor: disabled ? 'default' : 'pointer',
          color: parsed ? 'var(--text)' : 'var(--text-subtle)',
          ...style,
        }}
        {...rest}
      >
        <Icon name="calendar" size={15} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {parsed ? formatDate(value) : placeholder}
        </span>
      </button>
      {panel && createPortal(panel, document.body)}
    </div>
  );
}
