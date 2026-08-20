// Every date shown in the app goes through here.
//
// The old code passed `undefined` as the locale, which means "whatever this
// browser is set to". That is wrong for anyone travelling, on a work laptop
// configured somewhere else, or using a phone bought overseas — and 03/04/2026
// is the 3rd of April in Sydney and the 4th of March in New York, so it is not
// a cosmetic difference on a tax record.
//
// The locale comes from the account's country and is set once when the user
// loads. A module-level value rather than a prop because dates are shown in
// forty-odd places, most of which have no business knowing about the user.

let locale = 'en-AU';

export function setDateLocale(next) {
  if (next) locale = next;
}

export function getDateLocale() {
  return locale;
}

// Today, as an <input type="date"> reads it.
//
// Built from the local parts rather than toISOString(), which converts to UTC
// first: at any hour before 10am in Sydney that returns yesterday, so a "no
// future dates" limit would refuse today for half the working day.
export function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 03/04/2026 — the everyday form, ordered the way their country orders it.
export function formatDate(value, fallback = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString(locale) : fallback;
}

// 3 Apr 2026 — unambiguous, for anywhere the order could be misread.
export function formatDateShort(value, fallback = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : fallback;
}

// 3 April 2026
export function formatDateLong(value, fallback = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : fallback;
}

// 3 Apr — for lists where the year is already established by the grouping.
export function formatDayMonth(value, fallback = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }) : fallback;
}

// 3 Apr 2026, 2:30 pm
export function formatDateTime(value, fallback = '—') {
  const d = toDate(value);
  return d
    ? d.toLocaleString(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : fallback;
}

// Fri 3 Apr, 2:30 pm — for an appointment, where the weekday is the useful part.
export function formatAppointmentTime(value, fallback = '—') {
  const d = toDate(value);
  return d
    ? d.toLocaleString(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : fallback;
}

// April 2026 — chart axes and month groupings.
export function formatMonthYear(value, fallback = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString(locale, { month: 'long', year: 'numeric' }) : fallback;
}

// dd/mm/yyyy, hh:mm — for a deadline, where the exact day matters and reading
// it should not depend on knowing whether "08 Aug" is the eighth of August.
// Numeric on purpose, and always two digits, so the cut-off cannot be misread.
export function formatDeadline(value, fallback = '—') {
  const d = toDate(value);
  return d
    ? d.toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : fallback;
}
