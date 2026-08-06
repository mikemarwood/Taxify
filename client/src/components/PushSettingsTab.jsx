import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';
import { formatDateTime } from '../lib/dates.js';

// .card is border and background only — padding is the caller's, everywhere
// else in the admin panel. Named rather than repeated so these four cannot
// drift from each other.
const CARD = { padding: 20 };

// The Firebase connection.
//
// Firebase is only ever about one thing here: raising notifications in the
// phone's tray while the app is closed. Android gives a server no other way to
// reach an app that isn't running. Everything else — the bell, the history —
// works whether this is connected or not, which is why nothing on this page is
// phrased as an error.

const STEP_LABELS = {
  credential: 'Service account',
  auth: 'Google sign-in',
  messaging: 'Messaging API',
};

export default function PushSettingsTab() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState(null);
  const [check, setCheck] = useState(null);
  const [json, setJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');

  function load() {
    api
      .get('/admin/push-settings')
      .then((res) => setStatus(res.data))
      .catch(() => toast('Could not load Firebase settings', 'error'));
    api
      .get('/admin/push-settings/devices')
      .then((res) => setDevices(res.data.devices))
      .catch(() => setDevices([]));
  }

  useEffect(load, []);

  async function verify() {
    setBusy('verify');
    try {
      const { data } = await api.post('/admin/push-settings/verify');
      setCheck(data);
      toast(data.ok ? 'Connected to Firebase' : 'Firebase is not connected yet', data.ok ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.patch('/admin/push-settings', { serviceAccount: json });
      setJson('');
      setCheck(null);
      load();
      toast('Firebase credentials saved', 'success');
      // Saved and immediately proven, rather than saved and hoped for.
      verify();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Disconnect Firebase? Notifications will still appear inside the app.')) return;
    await api.patch('/admin/push-settings', { serviceAccount: '' }).catch(() => {});
    setCheck(null);
    load();
    toast('Firebase disconnected', 'success');
  }

  async function test() {
    setBusy('test');
    try {
      const { data } = await api.post('/admin/push-settings/test');
      if (data.delivered) toast(`Sent to ${data.delivered} device${data.delivered === 1 ? '' : 's'}`, 'success');
      else toast(data.warning || 'Nothing was delivered', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  }

  if (!status) return <div className="card" style={CARD}>Loading…</div>;

  const connected = status.configured && status.valid;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={CARD}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              background: connected ? 'rgba(16,185,129,0.14)' : 'var(--bg-inset)',
              color: connected ? 'var(--emerald)' : 'var(--text-muted)',
            }}
          >
            <Icon name={connected ? 'check-circle' : 'bolt'} size={19} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {connected ? 'Firebase connected' : 'Firebase not connected'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
              {connected ? (
                <>
                  Project <strong>{status.projectId}</strong>. The Android app can raise notifications while it is
                  closed.
                </>
              ) : status.configured ? (
                'A credential is saved but cannot be read. Paste the file again below.'
              ) : (
                'Notifications appear in the app only. Connect Firebase to also show them in the phone’s notification tray.'
              )}
            </div>
            {status.clientEmail && (
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 6, wordBreak: 'break-all' }}>
                {status.clientEmail}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 24,
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{status.devices}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Registered devices</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{status.users}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>People with the app</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={verify} disabled={!status.configured || busy === 'verify'}>
            {busy === 'verify' ? 'Checking…' : 'Test connection'}
          </button>
          <button className="btn btn-ghost" onClick={test} disabled={!connected || busy === 'test'}>
            {busy === 'test' ? 'Sending…' : 'Send myself a test notification'}
          </button>
          {status.configured && (
            <button className="btn btn-ghost" onClick={remove}>
              Disconnect
            </button>
          )}
        </div>

        {check && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14, display: 'grid', gap: 10 }}>
            {check.steps.map((s) => (
              <div key={s.name} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <Icon
                  name={s.ok ? 'check-circle' : 'alert'}
                  size={15}
                  style={{ color: s.ok ? 'var(--emerald)' : 'var(--amber)', flexShrink: 0, marginTop: 2 }}
                />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{STEP_LABELS[s.name] || s.name}</div>
                  {s.detail && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {s.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {/* The three steps fail for unrelated reasons, and each one depends
                on the one before it, so only the first failure is actionable. */}
            {!check.ok && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                Fix the first item above that isn’t ticked — the ones after it can’t be checked until it is.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={CARD}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Why this is needed</h3>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
          Taxify already shows notifications in the app — a recurring expense added, an accountant opening your books,
          a lodgement date coming up. Those only appear while somebody has Taxify open.
        </p>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
          To reach a phone whose screen is off, the message has to go through the operating system's own delivery
          service. On Android that service is Firebase Cloud Messaging, and Google does not offer another way in — an
          app cannot wake itself to check for messages, which is deliberate, and is why your battery lasts a day.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
          <strong style={{ color: 'var(--text)' }}>Nothing breaks without it.</strong> Every notification still arrives
          in the app and by email. Connecting Firebase only adds the phone's notification tray. No expense data is sent
          to Google — a push carries a title, a line of text and the id of the page to open.
        </p>
      </div>

      <div className="card" style={CARD}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>
          {status.configured ? 'Replace the service account' : 'Connect Firebase'}
        </h3>
        <ol style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <li>
            Create a Firebase project and add an Android app with the id <code>com.mikesapphub.taxify</code>.
          </li>
          <li>
            Put the downloaded <code>google-services.json</code> into <code>client/android/app/</code> and build a new
            APK. Without it the app runs perfectly well but can never register for notifications.
          </li>
          <li>
            In <strong>Project settings → Service accounts</strong>, choose <strong>Generate new private key</strong>,
            then paste the whole downloaded file below.
          </li>
        </ol>
        <textarea
          className="input"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={9}
          spellCheck={false}
          placeholder={'{\n  "type": "service_account",\n  "project_id": "…",\n  "private_key": "-----BEGIN PRIVATE KEY-----…"\n}'}
          style={{
            width: '100%',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.5,
            resize: 'vertical',
          }}
        />
        <p style={{ margin: '8px 0 12px', fontSize: 11.5, color: 'var(--text-subtle)' }}>
          Stored on the server and never shown again — replacing it is the only way to change it.
        </p>
        <button className="btn btn-primary" onClick={save} disabled={saving || !json.trim()}>
          {saving ? 'Saving…' : 'Save and test'}
        </button>
      </div>

      {devices && devices.length > 0 && (
        <div className="card" style={CARD}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Devices</h3>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Where a pushed notification would actually arrive. Usually the answer to “why didn’t I get it”.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 380 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '6px 8px 6px 0', fontWeight: 600 }}>Person</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>Platform</th>
                  <th style={{ padding: '6px 0 6px 8px', fontWeight: 600 }}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.token} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 8px 8px 0' }}>
                      <div>{d.name || d.email}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{d.email}</div>
                    </td>
                    <td style={{ padding: '8px' }}>{d.platform || '—'}</td>
                    <td style={{ padding: '8px 0 8px 8px', whiteSpace: 'nowrap' }}>
                      {formatDateTime(d.lastSeenAt || d.registeredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
