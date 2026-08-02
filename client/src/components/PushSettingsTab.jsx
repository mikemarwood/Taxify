import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';

// Where push notifications get switched on.
//
// Everybody already gets every notification inside the app — this only decides
// whether the Android app also raises them in the phone's notification tray
// while it is closed. Nothing here is required for Taxify to work.

export default function PushSettingsTab() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [json, setJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  function load() {
    api
      .get('/admin/push-settings')
      .then((res) => setStatus(res.data))
      .catch(() => toast('Could not load push settings', 'error'));
  }

  useEffect(load, []);

  async function save() {
    setSaving(true);
    try {
      await api.patch('/admin/push-settings', { serviceAccount: json });
      setJson('');
      load();
      toast('Firebase credentials saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Remove the Firebase credentials? Notifications will stay inside the app only.')) return;
    await api.patch('/admin/push-settings', { serviceAccount: '' }).catch(() => {});
    load();
    toast('Removed', 'success');
  }

  async function test() {
    setTesting(true);
    try {
      const { data } = await api.post('/admin/push-settings/test');
      if (data.delivered) toast(`Sent to ${data.delivered} device${data.delivered === 1 ? '' : 's'}`, 'success');
      else toast(data.warning || 'Nothing was delivered', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTesting(false);
    }
  }

  if (!status) return <div className="card">Loading…</div>;

  const state = status.configured && status.valid ? 'on' : status.configured ? 'broken' : 'off';
  const banner = {
    on: { icon: 'check-circle', colour: 'var(--green)', text: `Connected to Firebase project ${status.projectId}.` },
    broken: { icon: 'alert', colour: 'var(--amber)', text: 'A credential is saved but cannot be read. Paste the file again.' },
    off: { icon: 'info', colour: 'var(--text-muted)', text: 'Not set up. Notifications appear inside the app only.' },
  }[state];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Icon name={banner.icon} size={18} style={{ color: banner.colour, flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {state === 'on' ? 'Push notifications are on' : 'Push notifications are off'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{banner.text}</div>
            {status.clientEmail && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6, wordBreak: 'break-all' }}>
                {status.clientEmail}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 22, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{status.devices}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Registered devices</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{status.users}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>People with the app</div>
          </div>
        </div>

        {state === 'on' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <button className="btn" onClick={test} disabled={testing}>
              {testing ? 'Sending…' : 'Send myself a test'}
            </button>
            <button className="btn btn-ghost" onClick={remove}>
              Remove credentials
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>
          {status.configured ? 'Replace the service account' : 'Connect Firebase'}
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          In the Firebase console, open <strong>Project settings → Service accounts</strong> and choose{' '}
          <strong>Generate new private key</strong>. Paste the downloaded file below, whole. The Android app also needs{' '}
          <code>google-services.json</code> from the same project, added to the build before the next release.
        </p>
        <textarea
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
          The key is stored on the server and is never shown again — replacing it is the only way to change it.
        </p>
        <button className="btn btn-primary" onClick={save} disabled={saving || !json.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
