import { api } from './api.js';

// Registering the Android app for pushed notifications.
//
// Deliberately loaded at runtime rather than imported at the top: the plugin
// only exists in the Android build, and a static import would break the web
// bundle for everybody else. In a browser this function does nothing at all
// and returns quietly.
//
// Nothing here works until a Firebase project exists and its google-services
// file is in the Android app — see README. Until then the app still receives
// everything through the in-app notification list; this only adds the tray.

let started = false;

// Whether Firebase is actually delivering to this device.
//
// This matters to more than the tray. The notification bell polled every 45
// seconds regardless, so on a phone that already had push the same information
// was being fetched twice — once because Firebase said so, and eighty times an
// hour because a timer said so. The timer is the expensive half: each tick is a
// radio wake-up, and the radio is the part of a phone that costs battery.
//
// So the bell asks whether push is live and stops its timer when it is. It has
// to be told rather than guess, because registration is asynchronous and
// permission may be refused — in which case the timer is still the only thing
// that works and must stay.
let pushActive = false;
const activeListeners = new Set();
const messageListeners = new Set();

function announce(set, arg) {
  for (const fn of set) {
    try {
      fn(arg);
    } catch (err) {
      console.error('Push listener threw', err);
    }
  }
}

export function isPushActive() {
  return pushActive;
}

// Called when push starts working, so a caller that set up a timer before
// registration finished can take it down again.
export function onPushActiveChange(cb) {
  activeListeners.add(cb);
  return () => activeListeners.delete(cb);
}

// Called when a push lands while the app is open. Without this the tray showed
// the notification and the list behind it did not change until the next poll —
// which is the poll we are trying to get rid of.
export function onPushMessage(cb) {
  messageListeners.add(cb);
  return () => messageListeners.delete(cb);
}

export async function registerForPush() {
  if (started) return;
  if (typeof navigator === 'undefined' || !/TaxifyAndroid/i.test(navigator.userAgent || '')) return;
  started = true;

  try {
    const mod = await import('@capacitor/push-notifications').catch(() => null);
    const PushNotifications = mod?.PushNotifications;
    if (!PushNotifications) return;

    // Android 13 and later require the person to agree before anything can be
    // shown. Asking is the whole of the permission model — if they decline,
    // that is an answer, and it is not asked again.
    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return;

    // Named, so the phone's notification settings screen says "Taxify" rather
    // than "Miscellaneous" — which is what Android calls the channel it invents
    // when an app hasn't declared one.
    if (PushNotifications.createChannel) {
      await PushNotifications
        .createChannel({
          id: 'taxify_default',
          name: 'Taxify',
          description: 'Recurring expenses, accountant access and tax reminders',
          importance: 4,
          visibility: 1,
        })
        .catch(() => {});
    }

    PushNotifications.addListener('registration', (token) => {
      // The token changes whenever Android decides it should, so it is sent
      // every time rather than only on first run.
      api.post('/notifications/devices', { token: token.value, platform: 'android' }).catch(() => {});
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration failed', err);
    });

    // Tapping a notification opens what it is about.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = action?.notification?.data?.url;
      if (url && url.startsWith('/')) window.location.assign(url);
    });

    // Arriving while the app is open. Android does not put these in the tray,
    // so without this one the app showed nothing at all until the next poll,
    // and Firebase was doing none of the work it was installed for.
    PushNotifications.addListener('pushNotificationReceived', () => {
      announce(messageListeners);
    });

    await PushNotifications.register();

    // Only now: register() is what actually establishes delivery, and a bell
    // that stopped polling before this line would be relying on something that
    // had not started yet.
    pushActive = true;
    announce(activeListeners, true);
  } catch (err) {
    console.error('Push setup failed', err);
  }
}
