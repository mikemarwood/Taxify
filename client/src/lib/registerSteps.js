// The steps of the sign-up form, in order.
//
// Shared, because two places need the same list and they must not drift: the
// form draws them, and the traffic panel reports how far people got through
// them. A report that names a step the form no longer has, or misses one it
// gained, is a report nobody can act on.
//
// `key` is what gets recorded, not `label` — a label is copy and will be
// reworded, and rewording it must not orphan a month of measurements.
export const REGISTER_STEPS = [
  { key: 'you', label: 'About you', icon: 'users' },
  { key: 'where', label: 'Where you are', icon: 'globe' },
  { key: 'email', label: 'Your email', icon: 'mail' },
  { key: 'plan', label: 'Choose a plan', icon: 'tag' },
  { key: 'finish', label: 'Finish up', icon: 'check-circle' },
];

export function registerStepLabel(key) {
  return REGISTER_STEPS.find((s) => s.key === key)?.label || key;
}
