import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import OtpBenefits from '../components/OtpBenefits.jsx';
import Toggle from '../components/Toggle.jsx';
import Avatar from '../components/Avatar.jsx';
import AvatarEditorModal from '../components/AvatarEditorModal.jsx';
import { isSoundEnabled, setSoundEnabled } from '../lib/sounds.js';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

// Matches the sign-up form and the server: capital at the start of each word,
// the rest lower case, applied as they type.
function toPersonName(raw) {
  return String(raw)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function AvatarSection({ user, setUser }) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [editorSrc, setEditorSrc] = useState(null);
  const [editorIsBlobUrl, setEditorIsBlobUrl] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [removeConfirming, setRemoveConfirming] = useState(false);

  function closeEditor() {
    if (editorIsBlobUrl && editorSrc) URL.revokeObjectURL(editorSrc);
    setEditorSrc(null);
    setEditorIsBlobUrl(false);
  }

  function onSelectFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      toast('That image is too large — avatars must be 10MB or smaller.', 'error');
      return;
    }
    setEditorSrc(URL.createObjectURL(file));
    setEditorIsBlobUrl(true);
  }

  function openReposition() {
    if (!user.avatarUrl) return;
    setEditorSrc(user.avatarUrl);
    setEditorIsBlobUrl(false);
  }

  async function onSaveCrop(blob) {
    setAvatarBusy(true);
    setAvatarProgress(0);
    const form = new FormData();
    form.append('avatar', blob, 'avatar.png');
    try {
      const res = await api.post('/auth/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => setAvatarProgress(evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0),
      });
      setUser((u) => (u ? { ...u, avatarUrl: `${res.data.avatarUrl}?t=${Date.now()}` } : u));
      toast('Avatar updated', 'success');
      closeEditor();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAvatarBusy(false);
      setAvatarProgress(0);
    }
  }

  async function onConfirmRemove() {
    setAvatarBusy(true);
    try {
      await api.delete('/auth/avatar');
      setUser((u) => (u ? { ...u, avatarUrl: null } : u));
      toast('Avatar removed', 'success');
      setRemoveConfirming(false);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontWeight: 700 }}>Avatar</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size={72} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
            >
              Upload photo
            </button>
            {user.avatarUrl && (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={openReposition} disabled={avatarBusy}>
                Reposition
              </button>
            )}
            {user.avatarUrl && !removeConfirming && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 13 }}
                onClick={() => setRemoveConfirming(true)}
                disabled={avatarBusy}
              >
                Remove
              </button>
            )}
          </div>
          {removeConfirming && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Remove your avatar?</span>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '4px 10px', background: 'var(--red)' }}
                disabled={avatarBusy}
                onClick={onConfirmRemove}
              >
                {avatarBusy && <span className="spinner" />}
                Confirm
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setRemoveConfirming(false)}
                disabled={avatarBusy}
              >
                Cancel
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onSelectFile} />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Any image, up to 10MB.</span>
        </div>
      </div>

      {editorSrc && (
        <AvatarEditorModal
          imageSrc={editorSrc}
          busy={avatarBusy}
          progress={avatarProgress}
          onCancel={closeEditor}
          onSave={onSaveCrop}
        />
      )}
    </div>
  );
}

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
  const { user, updateProfile, changePassword, setOtpEnabled, setUser } = useAuth();
  const toast = useToast();

  // Everything captured at sign-up is editable here except how they heard
  // about us — that's a one-time answer about a moment that's passed.
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [email, setEmail] = useState(user.email);
  const [currency, setCurrency] = useState(user.currency || 'AUD');
  const [country, setCountry] = useState(user.country || '');
  const [state, setState] = useState(user.state || '');
  const [businessName, setBusinessName] = useState(user.businessName || '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [options, setOptions] = useState(null);

  // Same lists the sign-up form uses, so the two can't drift.
  useEffect(() => {
    api
      .get('/auth/signup-options')
      .then((res) => setOptions(res.data))
      .catch(() => setOptions({ countries: [], states: {}, currencies: [] }));
  }, []);

  const statesForCountry = useMemo(() => {
    if (!options || !country) return null;
    const match = options.countries.find((c) => c.name === country);
    return match ? options.states[match.code] || null : null;
  }, [options, country]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [mfaBusy, setMfaBusy] = useState(false);

  // Device-local, so it isn't sent to the server or shared between machines.
  const [soundOn, setSoundOn] = useState(isSoundEnabled);

  function onToggleSound(next) {
    setSoundEnabled(next);
    setSoundOn(next);
  }

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

  const profileChanged =
    firstName.trim() !== (user.firstName || '') ||
    lastName.trim() !== (user.lastName || '') ||
    dateOfBirth !== (user.dateOfBirth || '') ||
    phone.trim() !== (user.phone || '') ||
    email.trim().toLowerCase() !== user.email ||
    currency !== (user.currency || '') ||
    country.trim() !== (user.country || '') ||
    state.trim() !== (user.state || '') ||
    businessName.trim() !== (user.businessName || '');

  async function onSaveProfile(e) {
    e.preventDefault();
    setProfileBusy(true);
    try {
      await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth,
        phone: phone.trim(),
        email: email.trim(),
        currency,
        country: country.trim(),
        state: state.trim(),
        businessName: businessName.trim(),
      });
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

      <AvatarSection user={user} setUser={setUser} />

      {user.role === 'owner' && <BillingSection user={user} />}
      {user.role === 'owner' && <FamilySection user={user} />}

      <form onSubmit={onSaveProfile} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700 }}>Profile</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">First name</label>
            <input
              className="input"
              required
              maxLength={60}
              value={firstName}
              onChange={(e) => setFirstName(toPersonName(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Last name</label>
            <input
              className="input"
              required
              maxLength={60}
              value={lastName}
              onChange={(e) => setLastName(toPersonName(e.target.value))}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Date of birth</label>
            <input
              className="input"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Phone number</label>
            <input
              className="input"
              inputMode="tel"
              maxLength={20}
              placeholder="08 9123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ''))}
            />
          </div>
        </div>

        <div>
          <label className="label">Email</label>
          <input className="input" required type="email" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Country</label>
            <select
              className="input"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setState('');
                const match = options?.countries.find((c) => c.name === e.target.value);
                if (match) setCurrency(match.currency);
              }}
            >
              <option value="">—</option>
              {(options?.countries || []).map((c) => (
                <option key={c.code} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{statesForCountry ? 'State' : 'State or region'}</label>
            {statesForCountry ? (
              <select className="input" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">—</option>
                {statesForCountry.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                maxLength={80}
                disabled={!country}
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Preferred currency</label>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(options?.currencies || []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Business name (optional)</label>
            <input className="input" maxLength={120} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
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

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Interface sounds</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              Short tones on saving, errors, and opening a dialog. Stored on this device.
            </div>
          </div>
          <Toggle checked={soundOn} onChange={onToggleSound} />
        </div>
      </div>
    </div>
  );
}
