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
      {/* Deliberately not animated in.
          
          index.html paints this same logo, at this same size, as #boot — before
          any JavaScript has run. When React took over, this element animated
          itself from opacity 0 and 0.82 scale, so the mark that was already on
          screen vanished and sprang back: the app appeared to load twice.
          
          There is nothing to introduce here. The logo is already there; this
          just continues showing it, and the sweeping bar below carries the
          sense of movement on its own. */}
      <img
        src="/logo.svg"
        alt=""
        width="82"
        height="82"
        // 17 rather than 20: logo.svg carries its own 20.3% corners, so at
        // 82px anything larger clips into the mark and the shadow follows an
        // outline the artwork does not have.
        style={{ borderRadius: 17, boxShadow: '0 12px 34px -12px rgba(0, 0, 0, .6)' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6 }}>Taxify</span>
        <span style={{ fontSize: 12.5, letterSpacing: 0.3, color: 'rgba(234, 241, 251, .62)' }}>
          Powered by Mikes App Hub
        </span>
      </div>

      {/* A bar that sweeps rather than a percentage: there is nothing here
          worth measuring, and a fake percentage is a small lie. */}
      {/* Also not faded in, and for the same reason: #boot already has a bar in
          this position. Fading a second one up over it is the same flash. */}
      <div style={{ width: 168, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11 }}>
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
      </div>
    </div>
  );
}
