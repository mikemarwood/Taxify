import { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import OtpBenefits from '../components/OtpBenefits.jsx';

export default function Security() {
  const { user, setOtpEnabled } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !user.otpEnabled;
    setBusy(true);
    try {
      await setOtpEnabled(next);
      toast(next ? 'Email login codes are now on' : 'Email login codes are now off', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Security</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Manage how you sign in to Taxify.</p>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Email login codes (OTP)</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {user.otpEnabled
                ? 'On — a code is emailed to you at every login.'
                : 'Off — you sign in with just your password.'}
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={toggle} style={{ flexShrink: 0 }}>
            {busy && <span className="spinner" />}
            {user.otpEnabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
        <OtpBenefits />
      </div>
    </div>
  );
}
