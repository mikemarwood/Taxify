// A single stroked SVG icon set, replacing the emoji the UI used to lean on.
// Emoji render differently on every platform and read as decoration rather
// than interface — these inherit currentColor and line up on a 24px grid, so
// an icon in a button matches an icon in a badge matches an icon in the nav.
//
// Category names match the keys stored in categories.icon, so a category saved
// as "graduation-cap" keeps working untouched.

const PATHS = {
  // --- category icons ---
  receipt: (
    <>
      <path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z" />
      <path d="M9.5 8.5h5M9.5 12.5h5" />
    </>
  ),
  'graduation-cap': (
    <>
      <path d="M12 4 2.5 9 12 14l9.5-5z" />
      <path d="M6.5 11.2V16c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-4.8" />
      <path d="M21.5 9.3v4.5" />
    </>
  ),
  wrench: (
    <path d="M17.6 3.6a5 5 0 0 0-6.3 6.3L4 17.2a2.4 2.4 0 0 0 3.4 3.4l7.3-7.3a5 5 0 0 0 6.3-6.3l-2.9 2.9-2.6-.7-.7-2.6z" />
  ),
  cpu: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" />
    </>
  ),
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.3V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.3" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2.5" y="7.5" width="19" height="13" rx="2" />
      <path d="M8.5 7.5V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" />
      <path d="M2.5 12.5h19" />
    </>
  ),
  tag: (
    <>
      <path d="M20.4 13.3 13.3 20.4a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 2.9 12V4.5A1.6 1.6 0 0 1 4.5 2.9H12a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z" />
      <circle cx="7.6" cy="7.6" r="1.3" />
    </>
  ),
  car: (
    <>
      <path d="M4 15.5v-3.2l2.2-4.4A2 2 0 0 1 8 6.7h8a2 2 0 0 1 1.8 1.2l2.2 4.4v3.2" />
      <path d="M4 12.3h16M4 15.5h16" />
      <circle cx="8" cy="16.6" r="1.7" />
      <circle cx="16" cy="16.6" r="1.7" />
    </>
  ),
  plane: (
    <>
      <path d="M21.5 2.5 2.5 10.2l7.3 2.9 2.9 7.4z" />
      <path d="M21.5 2.5 9.8 13.1" />
    </>
  ),
  utensils: (
    <>
      <path d="M6 3v5a2 2 0 0 0 4 0V3" />
      <path d="M8 10v11" />
      <path d="M17 3c-1.8 1.6-2.6 4-2.6 6.5s.8 3.5 2.6 3.5" />
      <path d="M17 3v18" />
    </>
  ),
  phone: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.8 18.4h2.4" />
    </>
  ),
  bolt: <path d="M13.5 2 4 13.5h6.5L10.5 22 20 10.5h-6.5z" />,
  heart: (
    <path d="M20.8 5.7a5.4 5.4 0 0 0-7.7 0L12 6.8l-1.1-1.1a5.4 5.4 0 1 0-7.7 7.7l8.8 8.6 8.8-8.6a5.4 5.4 0 0 0 0-7.7z" />
  ),
  book: (
    <>
      <path d="M4 4.6A2.6 2.6 0 0 1 6.6 2H20v17.4H6.6A2.6 2.6 0 0 0 4 22z" />
      <path d="M4 19.4A2.6 2.6 0 0 1 6.6 16.8H20" />
    </>
  ),
  box: (
    <>
      <path d="M21 8.5 12 3.5 3 8.5v7l9 5 9-5z" />
      <path d="M3 8.5 12 13.5l9-5" />
      <path d="M12 13.5v7" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 10v4M18 10v4" />
    </>
  ),
  palette: (
    <>
      <path d="M12 2.5a9.5 9.5 0 0 0 0 19 2.2 2.2 0 0 0 2.2-2.2c0-.6-.2-1.1-.6-1.5a2.2 2.2 0 0 1 1.6-3.7h1.9a4.4 4.4 0 0 0 4.4-4.4c0-4.2-4.2-7.2-9.5-7.2z" />
      <circle cx="7.4" cy="10.6" r="1.1" />
      <circle cx="10.6" cy="6.9" r="1.1" />
      <circle cx="15.1" cy="7.6" r="1.1" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h2.2l1.3-2h6.6l1.3 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),

  // --- navigation ---
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="8.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  'plus-circle': (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 3.5v17h17" />
      <path d="M7 15.5l3.5-4 3 2.5 4.5-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),

  // --- interface ---
  file: (
    <>
      <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
      <path d="M14 2.5v5h5" />
    </>
  ),
  'file-text': (
    <>
      <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
      <path d="M14 2.5v5h5" />
      <path d="M8.5 13h7M8.5 16.5h4.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.7" />
      <path d="M21 15.5 16 10.5 6 19.5" />
    </>
  ),
  folder: (
    <path d="M3 6.5a2 2 0 0 1 2-2h3.8l2 2.5H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  'folder-plus': (
    <>
      <path d="M3 6.5a2 2 0 0 1 2-2h3.8l2 2.5H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 10.5v6M9 13.5h6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V3.5" />
      <path d="M8 7.5 12 3.5l4 4" />
      <path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v12" />
      <path d="M8 11.5 12 15.5l4-4" />
      <path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.8" />
      <path d="M15.4 15.4 21 21" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="10.5" cy="10.5" r="6.8" />
      <path d="M15.4 15.4 21 21" />
      <path d="M10.5 7.7v5.6M7.7 10.5h5.6" />
    </>
  ),
  trash: (
    <>
      <path d="M3.5 6.5h17" />
      <path d="M8.5 6.5v-2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2" />
      <path d="M6 6.5 7 20a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13.5" />
      <path d="M10 10.5v6.5M14 10.5v6.5" />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M8 12.3 10.9 15.2 16 9.3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M15 6V5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h1" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M4 12h15" />
      <path d="M13.5 6.5 20 12l-6.5 5.5" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M20 12H5" />
      <path d="M10.5 6.5 4 12l6.5 5.5" />
    </>
  ),
  'external-link': (
    <>
      <path d="M14 3.5h6.5V10" />
      <path d="M20.5 3.5 11.5 12.5" />
      <path d="M18 14.5v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 11.2v5.5" />
      <path d="M12 7.6h.01" />
    </>
  ),
  x: <path d="M5.8 5.8 18.2 18.2M18.2 5.8 5.8 18.2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  'chevron-down': <path d="M6 9.5 12 15.5l6-6" />,
  pointer: (
    <path d="M5.5 3.5 18 12.6l-5.4.6 2.8 5.9-2.4 1.2-2.8-6-3.7 3.9z" />
  ),
  gift: (
    <>
      <rect x="3" y="9.5" width="18" height="11.5" rx="1.5" />
      <path d="M2 9.5h20M12 9.5V21" />
      <path d="M12 9.5C10.5 6 9.2 4.2 7.6 4.2A2.3 2.3 0 0 0 7.6 8.8H12z" />
      <path d="M12 9.5c1.5-3.5 2.8-5.3 4.4-5.3a2.3 2.3 0 0 1 0 4.6H12z" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  pencil: (
    <>
      <path d="M16.4 3.6a2.3 2.3 0 0 1 3.2 3.2L8.3 18.1l-4.1 1 1-4.1z" />
      <path d="M14.6 5.4 18.6 9.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20.5v-1.3A5.4 5.4 0 0 1 10.2 13.8h3.6a5.4 5.4 0 0 1 5.4 5.4v1.3" />
    </>
  ),
  'credit-card': (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.2" />
      <path d="M2.5 9.8h19" />
      <path d="M6.2 14.6h3.4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 20.5v-1.3A5.2 5.2 0 0 1 7.7 14h2.6a5.2 5.2 0 0 1 5.2 5.2v1.3" />
      <path d="M16.2 5.1a3.4 3.4 0 0 1 0 6.3" />
      <path d="M18 14.3a5.2 5.2 0 0 1 3.5 4.9v1.3" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
      <path d="M7.8 10.5V7.3a4.2 4.2 0 0 1 8.4 0v3.2" />
      <path d="M12 15v2" />
    </>
  ),
  repeat: (
    <>
      <path d="M3.5 11V9.5a4 4 0 0 1 4-4h13" />
      <path d="M17 2 20.5 5.5 17 9" />
      <path d="M20.5 13v1.5a4 4 0 0 1-4 4h-13" />
      <path d="M7 15 3.5 18.5 7 22" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M2.8 12h18.4" />
      <path d="M12 2.8a14 14 0 0 1 0 18.4 14 14 0 0 1 0-18.4z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.6 4.5 5.7v6c0 4.4 3 8.4 7.5 9.7 4.5-1.3 7.5-5.3 7.5-9.7v-6z" />
      <path d="M9 12.1 11.3 14.4 15.4 10" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 6.5 12 13l9-6.5" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M5.5 5.5 18.5 18.5" />
    </>
  ),
  'log-out': (
    <>
      <path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M10 16.5 14.5 12 10 7.5" />
      <path d="M14.5 12H4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" />
      <path d="M13.8 20.5a2.1 2.1 0 0 1-3.6 0" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.7 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.5h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 1.9" />
    </>
  ),
};

export default function Icon({ name, size = 16, strokeWidth = 1.7, style, title, ...rest }) {
  const paths = PATHS[name] || PATHS.tag;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      style={{ flexShrink: 0, display: 'block', ...style }}
      {...rest}
    >
      {title && <title>{title}</title>}
      {paths}
    </svg>
  );
}
