import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import Icon from '../components/Icon.jsx';
import PromoCodesTab from '../components/PromoCodesTab.jsx';

const SWATCHES = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#ef4444', '#eab308', '#14b8a6', '#a1a1aa'];

// Storage figures are for a human deciding whether someone is using a lot, so
// one decimal at MB and above is plenty — the exact byte count would be noise.
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function Admin() {
  const [tab, setTab] = useState('users');

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Administration</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Manage user accounts and the default category template.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={tab === 'users' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('users')}>
          Users
        </button>
        <button className={tab === 'categories' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('categories')}>
          Default categories
        </button>
        <button className={tab === 'settings' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('settings')}>
          Settings
        </button>
        <button className={tab === 'email' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('email')}>
          Email server
        </button>
        <button className={tab === 'stripe' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('stripe')}>
          Stripe
        </button>
        <button className={tab === 'promos' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('promos')}>
          Promo codes
        </button>
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'categories' && <DefaultCategoriesTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'email' && <EmailSettingsTab />}
      {tab === 'stripe' && <StripeSettingsTab />}
      {tab === 'promos' && <PromoCodesTab />}
    </div>
  );
}

function CreateUserForm({ onCreated }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [planType, setPlanType] = useState('individual');
  const [busy, setBusy] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState(null);

  function reset() {
    setName('');
    setEmail('');
    setPlanType('individual');
    setOpen(false);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/admin/users', { name: name.trim(), email: email.trim(), planType });
      toast('User created — invite link sent', 'success');
      setAcceptUrl(res.data.acceptUrl);
      reset();
      onCreated();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(acceptUrl);
      toast('Link copied', 'success');
    } catch {
      toast('Could not copy — select and copy the link manually', 'error');
    }
  }

  if (!open && !acceptUrl) {
    return (
      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>
        Create user
      </button>
    );
  }

  return (
    <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {open && (
        <form onSubmit={onSubmit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontWeight: 700 }}>Create user</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              className="input"
              required
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="input"
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
              style={{ flex: 1 }}
            />
          </div>
          <select className="input" value={planType} onChange={(e) => setPlanType(e.target.value)} style={{ width: 200 }}>
            <option value="individual">Individual plan</option>
            <option value="family">Family plan</option>
          </select>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            They'll get an email with a link to set their own password and start their 14-day trial.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || !name.trim() || !email.trim()}>
              {busy && <span className="spinner" />}
              Create &amp; send invite
            </button>
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {acceptUrl && (
        <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, flex: 1, minWidth: 200 }}>
            Invite link (in case the email doesn't arrive):{' '}
            <span style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{acceptUrl}</span>
          </span>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={copyLink}>
            Copy link
          </button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setAcceptUrl(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState(null);

  function load() {
    api.get('/admin/users').then((res) => setUsers(res.data.users));
  }
  useEffect(load, []);

  async function toggleAdmin(u) {
    try {
      await api.patch(`/admin/users/${u.id}`, { isAdmin: !u.isAdmin });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Two steps on purpose. This removes an account and every trace of it —
  // expenses, categories, receipts, documents — with no undo, so typing the
  // email is the check that the right row is being deleted.
  async function deleteUser(u) {
    const first = window.confirm(
      `Delete ${u.name} (${u.email})?\n\n` +
        `This permanently removes their expenses, categories, receipts and documents ` +
        `(${formatBytes(u.storageBytes)} of files). It cannot be undone.`
    );
    if (!first) return;

    const typed = window.prompt(`Type the email address to confirm:\n${u.email}`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== u.email.toLowerCase()) {
      toast('That didn’t match — nothing was deleted', 'error');
      return;
    }

    try {
      const res = await api.delete(`/admin/users/${u.id}`);
      const extra = res.data?.deletedDependents
        ? ` and ${res.data.deletedDependents} linked login${res.data.deletedDependents === 1 ? '' : 's'}`
        : '';
      toast(`Deleted ${u.email}${extra}`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div>
      <CreateUserForm onCreated={load} />
      {users === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
      <AnimatePresence initial={false}>
        {users.map((u, i) => (
          <motion.div
            key={u.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 18px',
              borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {u.name} {u.id === me.id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(you)</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {u.email} · {u.expenseCount} expense{u.expenseCount === 1 ? '' : 's'} · joined{' '}
                {new Date(u.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div
              title="Total size of this user's uploaded receipts and property documents"
              style={{ textAlign: 'right', flexShrink: 0 }}
            >
              <div style={{ fontWeight: 700, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>
                {formatBytes(u.storageBytes)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>storage</div>
            </div>
            {!u.active && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 999,
                  color: 'var(--amber)',
                  background: 'rgba(245, 158, 11, 0.15)',
                }}
              >
                Invite pending
              </span>
            )}
            {u.isAdmin && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 999,
                  color: 'var(--red)',
                  background: 'rgba(239, 68, 68, 0.15)',
                }}
              >
                Administrator
              </span>
            )}
            {u.id !== me.id && (
              <>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                  onClick={() => toggleAdmin(u)}
                >
                  {u.isAdmin ? 'Demote' : 'Promote'}
                </button>
                {/* Admins are never deletable here — losing the last one
                    locks everyone out of this panel for good. */}
                {!u.isAdmin && (
                  <button
                    className="btn btn-ghost"
                    title="Permanently delete this account and everything in it"
                    style={{ fontSize: 12, padding: '6px 12px', color: 'var(--red)' }}
                    onClick={() => deleteUser(u)}
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const toast = useToast();
  const [registrationEnabled, setRegistrationEnabled] = useState(null);
  const [mfaMode, setMfaMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/settings').then((res) => {
      setRegistrationEnabled(res.data.registrationEnabled);
      setMfaMode(res.data.mfaMode);
    });
  }, []);

  async function toggle() {
    const next = !registrationEnabled;
    setBusy(true);
    try {
      await api.patch('/admin/settings', { registrationEnabled: next });
      setRegistrationEnabled(next);
      toast(next ? 'Registrations are now open' : 'Registrations are now closed', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode) {
    if (mode === mfaMode) return;
    setMfaBusy(true);
    try {
      await api.patch('/admin/settings', { mfaMode: mode });
      setMfaMode(mode);
      toast(
        mode === 'required' ? 'MFA is now required for every account' : 'MFA is now optional — users choose for themselves',
        'success'
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMfaBusy(false);
    }
  }

  if (registrationEnabled === null || mfaMode === null) return <SkeletonList rows={2} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700 }}>New account registration</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {registrationEnabled
              ? 'Anyone can currently create a new Taxify account.'
              : 'Sign-ups are closed — existing accounts can still log in normally.'}
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={toggle} style={{ flexShrink: 0 }}>
          {registrationEnabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700 }}>Multi-Factor Authentication (MFA)</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, marginBottom: 16 }}>
          {mfaMode === 'required'
            ? 'Every account must enter an emailed code at login. Users cannot turn this off.'
            : 'Off by default — new users start without MFA, but can turn it on any time in Account settings. They’ll occasionally be reminded of the benefits if they haven’t enabled it.'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={mfaMode === 'optional' ? 'btn btn-primary' : 'btn btn-ghost'}
            disabled={mfaBusy}
            onClick={() => setMode('optional')}
          >
            Optional
          </button>
          <button
            className={mfaMode === 'required' ? 'btn btn-primary' : 'btn btn-ghost'}
            disabled={mfaBusy}
            onClick={() => setMode('required')}
          >
            Required
          </button>
        </div>
      </div>
    </div>
  );
}

function EmailSettingsTab() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [password, setPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);

  function load() {
    api.get('/admin/email-settings').then((res) => {
      setForm(res.data);
      setTestTo(res.data.user || '');
    });
  }
  useEffect(load, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/admin/email-settings', {
        host: form.host,
        port: Number(form.port),
        secure: form.secure,
        user: form.user,
        from: form.from,
        ...(password ? { password } : {}),
      });
      setPassword('');
      toast('Email server settings saved', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const res = await api.post('/admin/email-settings/test', testTo ? { to: testTo } : {});
      toast(`Test email sent to ${res.data.to}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTesting(false);
    }
  }

  // Walks the whole chain and shows where it stops. "It didn't arrive" has
  // several causes and the send error on its own rarely says which.
  async function onDiagnose() {
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const res = await api.post('/admin/email-settings/diagnose', testTo ? { to: testTo } : {});
      setDiagnosis(res.data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDiagnosing(false);
    }
  }

  if (form === null) return <SkeletonList rows={4} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '-8px 0 0' }}>
        These settings control the SMTP server used to send login verification codes and other account emails.
      </p>

      <form onSubmit={onSave} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 3, fontSize: 13, fontWeight: 600 }}>
            SMTP host
            <input
              className="input"
              style={{ marginTop: 6, width: '100%' }}
              placeholder="smtp.example.com"
              value={form.host || ''}
              onChange={(e) => update('host', e.target.value)}
            />
          </label>
          <label style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            Port
            <input
              className="input"
              style={{ marginTop: 6, width: '100%' }}
              placeholder="587"
              value={form.port || ''}
              onChange={(e) => update('port', e.target.value)}
            />
          </label>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!form.secure} onChange={(e) => update('secure', e.target.checked)} />
          Use TLS/SSL (secure connection)
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            SMTP username
            <input
              className="input"
              style={{ marginTop: 6, width: '100%' }}
              value={form.user || ''}
              onChange={(e) => update('user', e.target.value)}
            />
          </label>
          <label style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            SMTP password
            <input
              className="input"
              type="password"
              style={{ marginTop: 6, width: '100%' }}
              placeholder={form.hasPassword ? '••••••••  (leave blank to keep current)' : ''}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600 }}>
          From address
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="Mikes App Hub <no-reply@mikesapphub.com>"
            value={form.from || ''}
            onChange={(e) => update('from', e.target.value)}
          />
        </label>

        <div>
          <button className="btn btn-primary" disabled={busy} type="submit">
            Save
          </button>
        </div>
      </form>

      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Send a test email</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Sends a test message using the settings above (save first if you just changed them).
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="you@example.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
          />
          <button className="btn btn-ghost" disabled={testing} onClick={onTest}>
            {testing ? 'Sending…' : 'Send test'}
          </button>
          <button className="btn btn-ghost" disabled={diagnosing} onClick={onDiagnose}>
            {diagnosing ? 'Checking…' : 'Diagnose'}
          </button>
        </div>

        {diagnosis && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {diagnosis.checks.map((c) => (
                <div key={c.step} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13 }}>
                  <Icon
                    name={c.ok ? 'check-circle' : 'alert'}
                    size={15}
                    style={{ color: c.ok ? 'var(--emerald)' : 'var(--red)', marginTop: 1, flexShrink: 0 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.step}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: c.ok ? 'var(--text-muted)' : 'var(--red)',
                        fontFamily: c.ok ? 'inherit' : 'Consolas, monospace',
                        wordBreak: 'break-word',
                      }}
                    >
                      {c.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <details style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <summary style={{ cursor: 'pointer' }}>Settings in use</summary>
              <div style={{ fontFamily: 'Consolas, monospace', marginTop: 6, lineHeight: 1.7 }}>
                <div>host: {diagnosis.config.host || '—'}</div>
                <div>port: {diagnosis.config.port}</div>
                <div>secure: {String(diagnosis.config.secure)}</div>
                <div>user: {diagnosis.config.user || '(none)'}</div>
                <div>password: {diagnosis.config.hasPassword ? 'set' : 'NOT SET'}</div>
                <div>from: {diagnosis.config.from || '—'}</div>
                <div>envelope from: {diagnosis.config.envelopeFrom || '—'}</div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function StripeModeSection({ label, hint, section, values, secretDraft, onFieldChange, onSecretChange, onTest, testing }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{hint}</div>
      </div>

      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Publishable key
        <input
          className="input"
          style={{ marginTop: 6, width: '100%' }}
          placeholder={section === 'test' ? 'pk_test_...' : 'pk_live_...'}
          value={values.publishableKey || ''}
          onChange={(e) => onFieldChange(section, 'publishableKey', e.target.value)}
        />
      </label>

      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Secret key
        <input
          className="input"
          type="password"
          style={{ marginTop: 6, width: '100%' }}
          placeholder={values.hasSecretKey ? '••••••••  (leave blank to keep current)' : section === 'test' ? 'sk_test_...' : 'sk_live_...'}
          value={secretDraft || ''}
          onChange={(e) => onSecretChange(section, e.target.value)}
        />
      </label>

      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Webhook signing secret
        <input
          className="input"
          style={{ marginTop: 6, width: '100%' }}
          placeholder="whsec_..."
          value={values.webhookSecret || ''}
          onChange={(e) => onFieldChange(section, 'webhookSecret', e.target.value)}
        />
      </label>

      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          Individual plan price ID
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="price_..."
            value={values.priceIndividual || ''}
            onChange={(e) => onFieldChange(section, 'priceIndividual', e.target.value)}
          />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          Family plan price ID
          <input
            className="input"
            style={{ marginTop: 6, width: '100%' }}
            placeholder="price_..."
            value={values.priceFamily || ''}
            onChange={(e) => onFieldChange(section, 'priceFamily', e.target.value)}
          />
        </label>
      </div>

      <div>
        <button className="btn btn-ghost" disabled={testing} onClick={() => onTest(section)} type="button">
          {testing ? 'Testing…' : `Test ${section} connection`}
        </button>
      </div>
    </div>
  );
}

function StripeSettingsTab() {
  const toast = useToast();
  const [mode, setMode] = useState(null);
  const [live, setLive] = useState({});
  const [test, setTest] = useState({});
  const [liveSecret, setLiveSecret] = useState('');
  const [testSecret, setTestSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [testingMode, setTestingMode] = useState(null);

  function load() {
    api.get('/admin/stripe-settings').then((res) => {
      setMode(res.data.mode);
      setLive(res.data.live);
      setTest(res.data.test);
    });
  }
  useEffect(load, []);

  function onFieldChange(section, field, value) {
    const setter = section === 'test' ? setTest : setLive;
    setter((f) => ({ ...f, [field]: value }));
  }

  function onSecretChange(section, value) {
    if (section === 'test') setTestSecret(value);
    else setLiveSecret(value);
  }

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/admin/stripe-settings', {
        mode,
        live: {
          publishableKey: live.publishableKey,
          webhookSecret: live.webhookSecret,
          priceIndividual: live.priceIndividual,
          priceFamily: live.priceFamily,
          ...(liveSecret ? { secretKey: liveSecret } : {}),
        },
        test: {
          publishableKey: test.publishableKey,
          webhookSecret: test.webhookSecret,
          priceIndividual: test.priceIndividual,
          priceFamily: test.priceFamily,
          ...(testSecret ? { secretKey: testSecret } : {}),
        },
      });
      setLiveSecret('');
      setTestSecret('');
      toast('Stripe settings saved', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onTest(section) {
    setTestingMode(section);
    try {
      const res = await api.post('/admin/stripe-settings/test', { mode: section });
      toast(`Connected to Stripe (${res.data.mode} mode)`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTestingMode(null);
    }
  }

  if (mode === null) return <SkeletonList rows={4} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '-8px 0 0' }}>
        These keys connect Taxify to Stripe for subscription checkout, billing portal, and webhooks. Keep separate
        live and test credentials here, then flip the active mode to try out plans with Stripe's test cards without
        touching real payments.
      </p>

      <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700 }}>Active mode</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {mode === 'test'
              ? 'Test mode is live — checkout, portal, and webhooks use your test credentials.'
              : 'Live mode is active — checkout, portal, and webhooks use your live credentials.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={mode === 'live' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setMode('live')}
          >
            Live
          </button>
          <button
            type="button"
            className={mode === 'test' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setMode('test')}
          >
            Test
          </button>
        </div>
      </div>

      <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StripeModeSection
          label="Live credentials"
          hint="Used for real customer payments when Active mode is set to Live."
          section="live"
          values={live}
          secretDraft={liveSecret}
          onFieldChange={onFieldChange}
          onSecretChange={onSecretChange}
          onTest={onTest}
          testing={testingMode === 'live'}
        />
        <StripeModeSection
          label="Test credentials"
          hint="Used with Stripe's test cards when Active mode is set to Test — nothing here touches real money."
          section="test"
          values={test}
          secretDraft={testSecret}
          onFieldChange={onFieldChange}
          onSecretChange={onSecretChange}
          onTest={onTest}
          testing={testingMode === 'test'}
        />

        <div>
          <button className="btn btn-primary" disabled={busy} type="submit">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function DefaultCategoriesTab() {
  const toast = useToast();
  const [categories, setCategories] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/admin/default-categories').then((res) => setCategories(res.data.categories));
  }
  useEffect(load, []);

  async function onAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/default-categories', { name, color });
      setName('');
      toast('Default category added — new signups will get it', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/admin/default-categories/${id}`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -12, marginBottom: 20 }}>
        This is the starter set every new account is seeded with. Changes here only affect future signups — existing
        users keep managing their own categories independently.
      </p>

      <form onSubmit={onAdd} className="card" style={{ padding: 20, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <input className="input" placeholder="New default category name" value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: 'flex', gap: 6 }}>
          {SWATCHES.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setColor(s)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: s,
                border: color === s ? '2px solid white' : '2px solid transparent',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit">
          Add
        </button>
      </form>

      {categories === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            {categories.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: 20 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 18px',
                  borderBottom: i < categories.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: c.color }} />
                <div style={{ flex: 1, fontWeight: 600 }}>{c.name}</div>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => onDelete(c.id)}>
                  Delete
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
