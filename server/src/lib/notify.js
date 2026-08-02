import crypto from 'crypto';
import pool from '../db.js';

// Telling someone something.
//
// Every notification is written to the database first and pushed second. That
// order matters: the record is the notification, and the push is only how it
// gets someone's attention. If Firebase is not configured — or the push fails,
// or the phone is off — the message is still there when they next open the app,
// which is the behaviour you actually want from anything about tax.

// Firebase service-account JSON, pasted into admin settings. Push is simply off
// until it is there; nothing else changes.
async function fcmCredentials() {
  const [rows] = await pool.execute(`SELECT value FROM settings WHERE \`key\` = 'fcm_service_account'`);
  if (!rows[0]?.value) return null;
  try {
    const json = JSON.parse(rows[0].value);
    if (!json.client_email || !json.private_key || !json.project_id) return null;
    return json;
  } catch {
    console.error('FCM service account in settings is not valid JSON — push is disabled');
    return null;
  }
}

// Google wants an OAuth token, and getting one means signing a JWT with the
// service account key. Cached until shortly before it expires, because this is
// a network round trip we would otherwise pay on every single notification.
let cachedToken = null;

// Which credential the cached token belongs to. Without this, replacing the
// service account in admin settings would keep pushing with the old one for up
// to an hour — the most confusing possible outcome of an action whose entire
// purpose was to change the credential.
function credentialFingerprint(creds) {
  return crypto.createHash('sha256').update(`${creds.client_email}:${creds.private_key}`).digest('hex').slice(0, 16);
}

async function accessTokenFor(creds) {
  const fingerprint = credentialFingerprint(creds);
  if (cachedToken && cachedToken.fingerprint === fingerprint && cachedToken.expires > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claim)}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(creds.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error('FCM token exchange failed', res.status, detail);
    const err = new Error(`Google refused the service account (HTTP ${res.status})`);
    err.detail = detail;
    throw err;
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('Google returned no access token');
  cachedToken = { value: data.access_token, fingerprint, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

// A token Google tells us is dead is deleted rather than retried forever —
// people uninstall apps, and a table of dead tokens slows every send down.
async function forgetToken(token) {
  await pool.execute('DELETE FROM device_tokens WHERE token = ?', [token]).catch(() => {});
}

async function pushToDevices(userId, { title, body, url }) {
  const creds = await fcmCredentials();
  if (!creds) return { pushed: 0, reason: 'not_configured' };

  const [devices] = await pool.execute('SELECT token FROM device_tokens WHERE user_id = ?', [userId]);
  if (devices.length === 0) return { pushed: 0, reason: 'no_devices' };

  const accessToken = await accessTokenFor(creds).catch((err) => {
    console.error('FCM auth failed', err.message);
    return null;
  });
  if (!accessToken) return { pushed: 0, reason: 'no_token' };

  let pushed = 0;
  for (const { token } of devices) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: body || '' },
            // Tapping the notification should land on the thing it is about.
            data: url ? { url } : {},
            android: { priority: 'HIGH', notification: { icon: 'ic_stat_taxify', color: '#1559b8' } },
          },
        }),
      });

      if (res.ok) pushed += 1;
      else if (res.status === 404 || res.status === 400) await forgetToken(token);
      else console.error('FCM send failed', res.status, (await res.text()).slice(0, 200));
    } catch (err) {
      console.error('FCM send threw', err.message);
    }
  }

  return { pushed };
}

// The one function the rest of the app calls. Never throws: failing to tell
// someone about a thing must not fail the thing itself.
export async function notify(userId, { title, body = null, url = null, kind = null }) {
  if (!userId || !title) return { recorded: false, pushed: 0, reason: 'invalid' };
  try {
    await pool.execute(
      'INSERT INTO notifications (user_id, title, body, url, kind) VALUES (?, ?, ?, ?, ?)',
      [userId, String(title).slice(0, 160), body ? String(body).slice(0, 500) : null, url, kind]
    );
    // The result is returned rather than swallowed so the admin test button can
    // say *why* nothing arrived — "no devices registered" and "Firebase not
    // configured" send you to completely different places.
    const result = await pushToDevices(userId, { title, body, url });
    return { recorded: true, ...result };
  } catch (err) {
    console.error('Failed to record notification', err.message);
    return { recorded: false, pushed: 0, reason: 'error' };
  }
}

export async function isPushConfigured() {
  return (await fcmCredentials()) !== null;
}

// Proving the connection works, without needing a phone in the room.
//
// Three separate things have to be true and they fail for completely different
// reasons, so each is reported separately rather than as one "it works" light:
//
//   1. The credential is stored and readable.
//   2. Google accepts it and issues a token — wrong here means the key was
//      revoked, or the clock is wrong, or the file was truncated on paste.
//   3. The messaging API answers for that project — wrong here means the API
//      was never enabled, or the service account has no role on the project.
//
// Step 3 sends a deliberately invalid device token with validate_only set.
// Nothing is delivered and no phone is involved: being told the *token* is
// wrong is proof that everything in front of the token is right.
export async function verifyFcm() {
  const steps = [];
  const step = (name, ok, detail = null) => {
    steps.push({ name, ok, detail });
    return ok;
  };

  const creds = await fcmCredentials();
  if (!creds) {
    step('credential', false, 'No readable service account is saved.');
    return { ok: false, steps, projectId: null };
  }
  step('credential', true, creds.client_email);

  let accessToken;
  try {
    accessToken = await accessTokenFor(creds);
    step('auth', true, 'Google issued an access token.');
  } catch (err) {
    step('auth', false, err.detail || err.message);
    return { ok: false, steps, projectId: creds.project_id };
  }

  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        validate_only: true,
        message: { token: 'connectivity-check-not-a-real-token', notification: { title: 'check', body: 'check' } },
      }),
    });

    if (res.status === 400) {
      // The token was rejected, which is the expected answer and means auth,
      // the project and the API are all fine.
      step('messaging', true, `Firebase project ${creds.project_id} is reachable.`);
      return { ok: true, steps, projectId: creds.project_id };
    }
    if (res.ok) {
      step('messaging', true, `Firebase project ${creds.project_id} is reachable.`);
      return { ok: true, steps, projectId: creds.project_id };
    }

    const body = (await res.text()).slice(0, 300);
    const explain = {
      403: 'The Firebase Cloud Messaging API is not enabled for this project, or this service account has no role on it.',
      404: `No Firebase project called ${creds.project_id}. Check the file came from the right project.`,
      401: 'Google rejected the token. Generate a new private key and paste it again.',
    };
    step('messaging', false, explain[res.status] || `Firebase answered HTTP ${res.status}. ${body}`);
    return { ok: false, steps, projectId: creds.project_id };
  } catch (err) {
    step('messaging', false, `Could not reach Firebase: ${err.message}. Check the server has outbound HTTPS.`);
    return { ok: false, steps, projectId: creds.project_id };
  }
}
