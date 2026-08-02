import { motion } from 'framer-motion';

// What you see while the app works out who you are.
//
// On the web this is a second or less. In the Android app it is the first thing
// after the launcher, so it carries the branding the native splash cannot: the
// mark, the name, and who made it. The background matches the native splash
// exactly, so the handover from one to the other is invisible.
export default function StartupScreen({ message = 'Loading your account' }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        padding: 24,
        background: 'linear-gradient(180deg, #10294c 0%, #143257 55%, #0d2444 100%)',
        color: '#eaf1fb',
        textAlign: 'center',
      }}
    >
      {/* The mark arrives first and settles, rather than fading in with
          everything else — it is the thing worth looking at. */}
      <motion.img
        src="/logo.svg"
        alt=""
        width="82"
        height="82"
        initial={{ opacity: 0, scale: 0.82, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        style={{ borderRadius: 20, boxShadow: '0 12px 34px -12px rgba(0, 0, 0, .6)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
      >
        <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6 }}>Taxify</span>
        <span style={{ fontSize: 12.5, letterSpacing: 0.3, color: 'rgba(234, 241, 251, .62)' }}>
          Powered by Mikes App Hub
        </span>
      </motion.div>

      {/* A bar that sweeps rather than a percentage: there is nothing here
          worth measuring, and a fake percentage is a small lie. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        style={{ width: 168, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11 }}
      >
        <div
          role="progressbar"
          aria-label={message}
          style={{
            width: '100%',
            height: 4,
            borderRadius: 999,
            background: 'rgba(255, 255, 255, .12)',
            overflow: 'hidden',
          }}
        >
          <motion.div
            animate={{ x: ['-110%', '260%'] }}
            transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              height: '100%',
              width: '42%',
              borderRadius: 999,
              background: 'linear-gradient(90deg, #4c94ec, #9cc4f2)',
            }}
          />
        </div>
        <span style={{ fontSize: 11.5, color: 'rgba(234, 241, 251, .5)' }}>{message}</span>
      </motion.div>
    </div>
  );
}
