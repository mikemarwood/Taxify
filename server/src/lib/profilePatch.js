// Which parts of a profile a request is actually asking to change.
//
// PATCH /auth/profile read every field whether or not it had been sent, so a
// caller updating one thing had to send the whole profile or be refused for the
// rest. The accountant setup panel sends { practiceName } and nothing else, and
// was answered with "First name must be at least 1 character" — about a field
// it had never mentioned and had no way to know.
//
// Absent and empty are different, and that difference is the whole rule.
// Omitting firstName leaves it alone; sending firstName: '' is somebody
// clearing their name, and that is still refused upstream. Only
// hasOwnProperty tells the two apart — a falsy check cannot, which is exactly
// how they came to be treated the same.
//
// Pure, and separate from the route, because the interesting part is not the
// SQL: it is which columns end up in it. That is a question with right and
// wrong answers and no database needed to ask it.

export function wasSent(body, field) {
  return Object.prototype.hasOwnProperty.call(body || {}, field);
}

// The name is stored three ways — first, last, and the two joined — so it is
// rebuilt from whichever halves were sent plus whichever were not. Sending only
// a last name must not blank the first one out of the joined form, which is the
// bug this shape exists to prevent.
export function mergedName(body, current, clean = (v) => String(v ?? '').trim()) {
  const first = wasSent(body, 'firstName') ? clean(body.firstName) : current?.firstName || '';
  const last = wasSent(body, 'lastName') ? clean(body.lastName) : current?.lastName || '';
  return { first, last, full: `${first} ${last}`.trim() };
}

// Column names paired with the values for them, for exactly the fields that
// were sent. Anything absent is not in the statement at all, so it cannot be
// overwritten with a guess at what it currently holds.
export function buildProfileUpdate(fields) {
  const sets = [];
  const values = [];
  for (const [column, value] of fields) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  return { sets, values };
}
