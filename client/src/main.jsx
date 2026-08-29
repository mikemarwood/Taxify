import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext.jsx';
import { EntityProvider } from './lib/EntityContext.jsx';
import { ConfirmProvider } from './lib/ConfirmContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import MaintenanceBoundary from './components/MaintenanceBoundary.jsx';
import LoginIntro, { isAndroidApp } from './components/LoginIntro.jsx';
import './theme.css';

// Progress, moved from the boot screen's own timer to the things that
// actually have to finish. Each step is worth a share of the bar; the last one
// is the app saying it has something to show.
//
// Deliberately not a fake timer counting to 100 while the real work carries on
// behind it — a bar that reaches the end before the page does is a lie, and one
// that reaches it after looks broken.
window.__taxifyBoot = (function () {
  const bar = document.querySelector('#boot i b');
  const screen = document.getElementById('boot');
  let at = 0;

  return {
    to(percent) {
      // Never backwards. Two things finishing out of order should not make the
      // bar retreat.
      at = Math.max(at, Math.min(100, percent));
      if (bar) bar.style.width = at + '%';
    },
    done() {
      this.to(100);
      if (!screen) return;
      // A beat at 100 before it goes, or the fill is never seen to finish —
      // it would jump to full and vanish in the same frame.
      setTimeout(() => {
        screen.classList.add('done');
        setTimeout(() => screen.remove(), 320);
      }, 180);
    },
  };
})();

// Mounted: React has run, though it may still be waiting on who you are.
window.__taxifyBoot.to(45);

// A way out if the answer never comes. A request that hangs — a phone that has
// wandered off the network mid-load — would otherwise leave somebody staring at
// a logo forever with no way past it. Ten seconds, then the app is shown
// whatever state it is in; the page behind can say what is wrong far better
// than a stalled progress bar can.
setTimeout(() => window.__taxifyBoot?.done(), 10000);

// When the film is allowed to play.
//
// In a browser: the sign-in page, which is where a new customer arrives, and
// nowhere else — nobody wants ten seconds of animation in front of the expense
// they were halfway through. In the Android app: the launch itself, because
// somebody who stays signed in never sees sign-in again, and "on a new install
// or after an update" is a thing that happens to the app rather than to a
// page.
function IntroGate() {
  const { pathname } = useLocation();
  return <LoginIntro armed={isAndroidApp() || pathname === '/login'} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Every route in the app is written without the prefix — "/expenses",
        "/account" — and this is what puts /app in front of all of them, for
        both matching and for the links React Router builds. Setting it here
        rather than editing several hundred paths is the whole reason a
        basename exists. */}
    <BrowserRouter basename="/app">
      <ToastProvider>
        <AuthProvider>
          {/* Inside AuthProvider, because which sets of books exist depends on
              who is signed in — and on whose books an accountant has open. */}
          <EntityProvider>
            {/* Innermost, so anything rendered can ask — and above App so the one
                dialog sits over whatever asked for it. */}
            <ConfirmProvider>
              {/* Holds the door for everybody but staff while the site is
                  switched off from the admin panel. Inside the router, because
                  it lets the sign-in page through by path — which is what
                  stops the switch locking out the person who threw it. */}
              <MaintenanceBoundary>
                {/* The welcome film. Above everything and outside every page,
                    because it covers the app rather than sitting inside one
                    screen of it — and inside the router, because in a browser
                    it waits for the sign-in page. */}
                <IntroGate />
                <App />
              </MaintenanceBoundary>
            </ConfirmProvider>
          </EntityProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
