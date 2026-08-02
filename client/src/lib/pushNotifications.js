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

    await PushNotifications.register();
  } catch (err) {
    console.error('Push setup failed', err);
  }
}
