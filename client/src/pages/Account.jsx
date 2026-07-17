import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import OtpBenefits from '../components/OtpBenefits.jsx';
import Toggle from '../components/Toggle.jsx';

function BillingSection({ user }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function goToCheckout() {
    setBusy(true);
    try {
      const res = await api.post('/billing/checkout');
      window.location.href = res.data.url;
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  async function goToPortal() {
    setBusy(true);
    try {
      const res = await api.post('/billing/portal');
      window.location.href = res.data.url;
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  const planLabel = user.planType === 'family' ? 'Family' : 'Individual';

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontWeight: 700 }}>Plan &amp; billing</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Plan: <strong style={{ color: 'var(--text)' }}>{planLabel}</strong>
      </div>

      {user.subscriptionStatus === 'trialing' && user.trialEndsAt && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Free trial ends{' '}
          <strong style={{ color: 'var(--text)' }}>
            {new Date(user.trialEndsAt).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })}
          </strong>
        </div>
      )}
      {user.subscriptionStatus === 'active' && user.subscriptionCurrentPeriodEnd && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Renews{' '}
          <strong style={{ color: 'var(--text)' }}>
            {new Date(user.subscriptionCurrentPeriodEnd).toLocaleDateString(undefined, {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </strong>
        </div>
      )}
      {(user.subscriptionStatus === 'expired' || user.subscriptionStatus === 'canceled') && (
        <div style={{ fontSize: 13, color: 'var(--red)' }}>Your access is currently restricted.</div>
      )}
      {user.subscriptionStatus === 'past_due' && (
        <div style={{ fontSize: 13, color: 'var(--amber)' }}>Your last payment failed — please update your card.</div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        {user.subscriptionStatus === 'active' ? (
          <button className="btn btn-ghost" onClick={goToPortal} disabled={busy} style={{ fontSize: 13 }}>
            {busy && <span className="spinner" />}
            Manage billing
          </button>
        ) : (
          <button className="btn btn-primary" onClick={goToCheckout} disabled={busy} style={{ fontSize: 13 }}>
            {busy && <span className="spinner" />}
            Subscribe — {user.planType === 'family' ? '$79/yr' : '$49/yr'}
          </button>
        )}
      </div>
    </div>
  );
}

function FamilySection({ user }) {
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState(user.planType === 'family' ? 'sub_user' : 'accountant');
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/auth/family').then((res) => setMembers(res.data.members));
  }

  useEffect(load, []);

  const hasSubUser = members?.some((m) => m.role === 'sub_user');
  const hasAccountant = members?.some((m) => m.role === 'accountant');
  const canInviteSubUser = user.planType === 'family' && !hasSubUser;
  const canInviteAccountant = !hasAccountant;

  async function onInvite(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/invite', { name: inviteName.trim(), email: inviteEmail.trim().toLowerCase(), role: inviteRole });
      toast('Invitation sent', 'success');
      setInviteName('');
      setInviteEmail('');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id) {
    try {
      await api.delete(`/auth/family/${id}`);
      toast('Access removed', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontWeight: 700 }}>Family &amp; accountant access</div>

      {members?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 600, flex: 1 }}>{m.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{m.email}</span>
              <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                {m.role === 'sub_user' ? 'family member' : 'accountant'}
              </span>
              <span style={{ color: m.active ? 'var(--emerald)' : 'var(--text-muted)' }}>
                {m.active ? 'Active' : 'Invite pending'}
              </span>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => onRemove(m.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {(canInviteSubUser || canInviteAccountant) && (
        <form onSubmit={onInvite} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input
              className="input"
              required
              placeholder="Name"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
            <input
              className="input"
              required
              type="email"
              placeholder="Email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value.toLowerCase())}
            />
          </div>
          <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            {canInviteSubUser && <option value="sub_user">Family member (full access)</option>}
            {canInviteAccountant && <option value="accountant">Accountant (read-only)</option>}
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start', fontSize: 13 }}>
            {busy && <span className="spinner" />}
            Send invite
          </button>
        </form>
      )}

      {!canInviteSubUser && user.planType !== 'family' && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          Upgrade to the Family plan to add a second full-access user.
        </p>
      )}
    </div>
  );
}

export default function Account() {
  const { user, updateProfile, changePassword, setOtpEnabled } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [profileBusy, setProfileBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [mfaBusy, setMfaBusy] = useState(false);

  async function toggleMfa(enabled) {
    setMfaBusy(true);
    try {
      await setOtpEnabled(enabled);
      toast(enabled ? 'MFA is now on' : 'MFA is now off', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMfaBusy(false);
    }
  }

  const profileChanged = name.trim() !== user.name || email.trim().toLowerCase() !== user.email;

  async function onSaveProfile(e) {
    e.preventDefault();
    setProfileBusy(true);
    try {
      await updateProfile(name.trim(), email.trim());
      toast('Account details updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setProfileBusy(false);
    }
  }

  async function onSavePassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast('New passwords do not match', 'error');
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast('Password updated', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Account settings</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Update your details, password, and how you sign in.</p>
      </div>

      {user.role === 'owner' && <BillingSection user={user} />}
      {user.role === 'owner' && <FamilySection user={user} />}

      <form onSubmit={onSaveProfile} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700 }}>Profile</div>
        <div>
          <label className="label">Name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" required type="email" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={profileBusy || !profileChanged} style={{ alignSelf: 'flex-start' }}>
          {profileBusy && <span className="spinner" />}
          Save changes
        </button>
      </form>

      <form onSubmit={onSavePassword} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700 }}>Change password</div>
        <div>
          <label className="label">Current password</label>
          <input
            className="input"
            required
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">New password</label>
            <input className="input" required type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input
              className="input"
              required
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          At least 8 characters, with an uppercase letter, a lowercase letter, and a number.
        </p>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
          style={{ alignSelf: 'flex-start' }}
        >
          {passwordBusy && <span className="spinner" />}
          Update password
        </button>
      </form>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Multi-Factor Authentication (MFA)</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {user.mfaMode === 'required'
                ? 'Required — a code is emailed to you at every login.'
                : user.otpEnabled
                ? 'On — a code is emailed to you at every login.'
                : 'Off — turn it on for an extra layer of protection.'}
            </div>
          </div>
          {user.mfaMode === 'optional' && (
            <Toggle checked={user.otpEnabled} disabled={mfaBusy} onChange={toggleMfa} />
          )}
        </div>
        <OtpBenefits />
      </div>
    </div>
  );
}
