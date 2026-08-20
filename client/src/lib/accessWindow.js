// How long an accountant's look at somebody's books lasts, said in words.
//
// The comment beside the original said it is "said the same way in the picker,
// the summary line and the emails" — which was true of the wording and not of
// the code: the function lived inside Account.jsx, so the picker could not
// reach it and would have had to say the same thing a second way. It lives
// here instead, and the next page that needs it imports it.
//
// The server keeps its own copy for the emails. One of the two has to be first,
// and an email is composed where there is no client code to call.
export function describeHours(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return '24 hours';
  return n === 24 ? '24 hours' : `${n / 24} days`;
}
