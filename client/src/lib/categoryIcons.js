export const ICON_EMOJI = {
  receipt: '🧾',
  'graduation-cap': '🎓',
  wrench: '🛠️',
  cpu: '💻',
  home: '🏠',
  briefcase: '💼',
  tag: '🏷️',
  car: '🚗',
  plane: '✈️',
  utensils: '🍽️',
  phone: '📱',
  bolt: '⚡',
  heart: '🏥',
  book: '📚',
  box: '📦',
  cash: '💰',
  palette: '🎨',
  camera: '📸',
};

export const ICON_OPTIONS = Object.keys(ICON_EMOJI);

export function iconEmoji(icon) {
  return ICON_EMOJI[icon] || ICON_EMOJI.tag;
}
