import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The app is served under /app; the root belongs to the landing page.
  //
  // This is what rewrites the script and stylesheet URLs Vite writes into
  // index.html. Without it the built page asks for /assets/… at the root,
  // where the landing page now lives, and comes back with HTML where it
  // expected JavaScript — a blank screen with nothing in the console to
  // explain it.
  base: '/app/',
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Split so a deploy doesn't make every phone re-download everything.
        // The app's own code changes constantly; React and framer-motion
        // change a few times a year, so keeping them in their own files means
        // a routine deploy invalidates the small one and leaves the large ones
        // in cache. That matters more here than usual — the Android app loads
        // this over whatever connection somebody happens to be on.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Left alone deliberately. The push-notifications plugin is loaded
          // with a dynamic import so a browser never downloads it — naming a
          // chunk for it would pull it back into an eagerly loaded file and
          // undo that.
          if (id.includes('@capacitor')) return undefined;
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'motion';
          }
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('scheduler')) {
            return 'react';
          }
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
