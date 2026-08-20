// The small readings the Other deductions page needs, in one place so the
// field and the button that submits it cannot disagree about what "filled in"
// means.

// Kilometres, grouped as they are typed.
//
// Whole kilometres only. A trip log is a count of kilometres, the rate is cents
// per kilometre, and nobody has ever needed to claim 3000.4 of them — allowing
// a decimal point only invites a stray one that quietly changes the claim.
//
// The separators are stripped before anything is done with the number, so what
// is displayed and what is sent are never the same string.
export function kmWhileTyping(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '').slice(0, 7);
  if (!digits) return '';
  // No leading zeros: "007" is a typo, not seven kilometres written carefully.
  const n = String(Number(digits));
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function parseKm(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

// Hours and minutes, held as the decimal the database wants.
//
// Somebody asked for "half an hour" to be 0.30, which is how a clock reads and
// not how a decimal does — 0.30 hours is eighteen minutes, so typing it would
// have quietly under-claimed by two fifths. Rather than choose which of the two
// readings to enforce, the field stops being typed at all: hours and minutes
// are chosen, and the decimal is worked out. There is then nothing to get
// wrong, and nothing to explain.
export function toDecimalHours(hours, minutes) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  // Two places, because the column is DECIMAL(5,2) — rounding here rather than
  // letting the database do it silently means what is shown back is what was
  // stored.
  return Math.round((h + m / 60) * 100) / 100;
}

// The way round for reading: 2.25 is "2h 15m", which is what somebody checking
// their own log expects to see.
export function formatHours(decimal) {
  const total = Math.round(Number(decimal ?? 0) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}
