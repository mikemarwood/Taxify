import { motion, useReducedMotion } from 'framer-motion';

// An abstract composition of the things the app actually handles — a docket, a
// filed receipt, a rising column chart. Drawn rather than photographed: a
// stock photo of someone at a laptop says nothing about this product, and a
// vector holds up at any size without shipping an asset.
//
// The drift is slow and small on purpose. It should read as depth when you
// glance at it, not as something demanding attention while you type.
export default function SignupArtwork() {
  const still = useReducedMotion();

  const float = (delay, distance = 8) =>
    still
      ? {}
      : {
          animate: { y: [0, -distance, 0] },
          transition: { duration: 7, repeat: Infinity, ease: 'easeInOut', delay },
        };

  return (
    <motion.svg
      viewBox="0 0 320 260"
      style={{ width: '100%', maxWidth: 340, height: 'auto', display: 'block' }}
      aria-hidden="true"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
    >
      <defs>
        <linearGradient id="sa-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="sa-bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#56a3f5" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#56a3f5" stopOpacity="0.95" />
        </linearGradient>
        <radialGradient id="sa-glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#56a3f5" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#56a3f5" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ambient light behind the stack, so the shapes sit in something. */}
      <circle cx="168" cy="120" r="108" fill="url(#sa-glow)" />

      {/* Back card: the year's summary. */}
      <motion.g {...float(0.6, 6)}>
        <rect x="150" y="30" width="132" height="96" rx="10" fill="url(#sa-card)" stroke="#ffffff" strokeOpacity="0.18" />
        <rect x="164" y="46" width="52" height="6" rx="3" fill="#ffffff" fillOpacity="0.5" />
        <rect x="164" y="60" width="86" height="5" rx="2.5" fill="#ffffff" fillOpacity="0.22" />
        <g>
          <rect x="164" y="94" width="14" height="18" rx="3" fill="url(#sa-bar)" />
          <rect x="184" y="84" width="14" height="28" rx="3" fill="url(#sa-bar)" />
          <rect x="204" y="72" width="14" height="40" rx="3" fill="url(#sa-bar)" />
          <rect x="224" y="88" width="14" height="24" rx="3" fill="url(#sa-bar)" />
          <rect x="244" y="60" width="14" height="52" rx="3" fill="url(#sa-bar)" />
        </g>
      </motion.g>

      {/* The docket itself, torn along the bottom. */}
      <motion.g {...float(0, 9)}>
        <path
          d="M42 66h96v132l-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5z"
          fill="url(#sa-card)"
          stroke="#ffffff"
          strokeOpacity="0.26"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <rect x="58" y="86" width="46" height="6" rx="3" fill="#ffffff" fillOpacity="0.55" />
        <rect x="58" y="102" width="64" height="4.5" rx="2.25" fill="#ffffff" fillOpacity="0.22" />
        <rect x="58" y="114" width="52" height="4.5" rx="2.25" fill="#ffffff" fillOpacity="0.22" />
        <rect x="58" y="126" width="60" height="4.5" rx="2.25" fill="#ffffff" fillOpacity="0.22" />
        <rect x="58" y="146" width="30" height="4.5" rx="2.25" fill="#ffffff" fillOpacity="0.22" />
        <rect x="98" y="144" width="24" height="8" rx="4" fill="#56a3f5" fillOpacity="0.9" />
      </motion.g>

      {/* Filed and done. */}
      <motion.g {...float(1.2, 7)}>
        <circle cx="228" cy="182" r="30" fill="#0f2544" stroke="#56a3f5" strokeOpacity="0.5" strokeWidth="1.5" />
        <path
          d="M215 182l9 9 18-18"
          fill="none"
          stroke="#56a3f5"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.g>

      {/* Loose particles for depth. */}
      <motion.circle cx="118" cy="42" r="3.5" fill="#56a3f5" fillOpacity="0.7" {...float(0.9, 5)} />
      <motion.circle cx="286" cy="152" r="2.5" fill="#ffffff" fillOpacity="0.4" {...float(1.6, 6)} />
      <motion.circle cx="34" cy="212" r="3" fill="#56a3f5" fillOpacity="0.45" {...float(0.3, 5)} />
    </motion.svg>
  );
}
