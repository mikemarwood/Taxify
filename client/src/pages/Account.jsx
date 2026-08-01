import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import OtpBenefits from '../components/OtpBenefits.jsx';
import Toggle from '../components/Toggle.jsx';
import Avatar from '../components/Avatar.jsx';
import AvatarEditorModal from '../components/AvatarEditorModal.jsx';
import { isSoundEnabled, setSoundEnabled } from '../lib/sounds.js';
import PlanComparison from '../components/PlanComparison.jsx';
import ChangeEmailSection from '../components/ChangeEmailSection.jsx';

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

      {/* Both plans in full, with the current one marked. Prices come from
          Stripe rather than being written here, so what's quoted is what will
          be charged. */}
      <PlanComparison user={user} />

      <div style={{ display: 'flex', gap: 10 }}>
        {user.subscriptionStatus === 'active' ? (
          <button className="btn btn-ghost" onClick={goToPortal} disabled={busy} style={{ fontSize: 13 }}>
            {busy && <span className="spinner" />}
            Manage billing
          </button>
        ) : (
          <button className="btn btn-primary" onClick={goToCheckout} disabled={busy} style={{ fontSize: 13 }}>
            {busy && <span className="spinner" />}
            Subscribe to {planLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// A handful of years back and the current one — the range anyone would
// actually hand an accountant.
function yearOptions() {
  const now = new Date();
  const current = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const list = [];
  for (let start = current; start >= current - 6; start--) list.push(`${start}-${start + 1}`);
  return list;
}

function formatWhen(value) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Someone invited only to read other people's books, who wants Taxify for
// their own tax as well. Same login, ordinary account — being an accountant
// was never meant to be an alternative to being a customer.
function StartOwnAccount() {
  const toast = useToast();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      await api.post('/auth/start-own-account');
      await refresh();
      toast('Your own account is ready — your 14-day trial has started', 'success');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name="briefcase" size={18} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700 }}>You're signed in as an accountant</span>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
        Right now this login only opens the books your clients have shared with you. If you want to track your own
        expenses and receipts as well, you can start an ordinary Taxify account on this same login — a 14-day trial,
        the same plans as anyone else, and every client you already have stays exactly as it is.
      </p>
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start', fontSize: 13 }} disabled={busy} onClick={start}>
        {busy && <span className="spinner" />}
        Start tracking my own expenses
      </button>
    </div>
  );
}

function FamilySection({ user }) {
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const [accountants, setAccountants] = useState(null);
  const [windowHours, setWindowHours] = useState(24);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState(user.planType === 'family' ? 'sub_user' : 'accountant');
  const [allYears, setAllYears] = useState(true);
  const [pickedYears, setPickedYears] = useState([]);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/auth/family').then((res) => setMembers(res.data.members));
    api.get('/auth/accountant-access').then((res) => {
      setAccountants(res.data.accountants);
      setWindowHours(res.data.windowHours || 24);
    });
  }

  useEffect(load, []);

  const hasSubUser = members?.some((m) => m.role === 'sub_user');
  const canInviteSubUser = user.planType === 'family' && !hasSubUser;

  async function onInvite(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/invite', {
        name: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        // Omitted entirely for a family member — the server ignores it, and
        // sending it anyway would suggest it did something.
        ...(inviteRole === 'accountant' && !allYears ? { financialYears: pickedYears } : {}),
      });
      toast(inviteRole === 'accountant' ? 'Access granted — we’ve emailed them' : 'Invitation sent', 'success');
      setInviteName('');
      setInviteEmail('');
      setPickedYears([]);
      setAllYears(true);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveMember(id) {
    try {
      await api.delete(`/auth/family/${id}`);
      toast('Access removed', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function onRevokeAccountant(assignment) {
    if (!window.confirm(`Remove ${assignment.name}'s access to your account?`)) return;
    try {
      await api.delete(`/auth/accountant-access/${assignment.id}`);
      toast('Accountant access removed', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const canSubmit =
    inviteName.trim() &&
    inviteEmail.trim() &&
    (inviteRole !== 'accountant' || allYears || pickedYears.length > 0);

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontWeight: 700 }}>Family &amp; accountant access</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.55 }}>
          A family member shares this account fully and permanently. An accountant gets a read-only look that ends on
          its own.
        </div>
      </div>

      {members?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
              }}
            >
              <Icon name={m.role === 'sub_user' ? 'users' : 'briefcase'} size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 600 }}>{m.name}</span>
              <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 140 }}>{m.email}</span>
              <span style={{ color: m.active ? 'var(--emerald)' : 'var(--text-muted)', fontSize: 12 }}>
                {m.active ? 'Active' : 'Invite pending'}
              </span>
              {/* Two people on a Family plan are equals — removing one is an
                  administrator's call, not a race between them. */}
              {m.role === 'sub_user' ? (
                <span
                  title="Family members share full access. Contact support to remove one."
                  style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <Icon name="lock" size={12} />
                  Full access
                </span>
              ) : (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '5px 11px' }}
                  onClick={() => onRemoveMember(m.id)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {accountants?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Accountants with access
          </div>
          {accountants.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
              }}
            >
              <Icon name="briefcase" size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 600 }}>{a.name}</span>
              <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 140 }}>{a.email}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {a.financialYears ? `FY ${a.financialYears.join(', ')}` : 'All years'}
              </span>
              <span style={{ fontSize: 11.5, color: a.expiresAt ? 'var(--amber)' : 'var(--text-muted)' }}>
                {a.expiresAt ? `Ends ${formatWhen(a.expiresAt)}` : 'Not opened yet'}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 11px' }}
                onClick={() => onRevokeAccountant(a)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onInvite} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          <option value="accountant">Accountant — read-only, {windowHours} hours</option>
          {canInviteSubUser && <option value="sub_user">Family member — full, permanent access</option>}
        </select>

        {inviteRole === 'accountant' && (
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-inset)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="label" style={{ margin: 0 }}>
              How much of your history can they see?
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={allYears} onChange={() => setAllYears(true)} />
              Every financial year
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={!allYears} onChange={() => setAllYears(false)} />
              Only the years I choose
            </label>

            {!allYears && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 2 }}>
                {yearOptions().map((y) => {
                  const on = pickedYears.includes(y);
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setPickedYears((prev) => (on ? prev.filter((p) => p !== y) : [...prev, y]))}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '6px 11px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        color: on ? '#fff' : 'var(--text-muted)',
                        background: on ? 'var(--accent)' : 'var(--bg-card)',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      FY {y}
                    </button>
                  );
                })}
              </div>
            )}

            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Their access begins the first time they open your books and is removed automatically {windowHours} hours
              later. They can never change anything.
            </p>
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy || !canSubmit} style={{ alignSelf: 'flex-start', fontSize: 13 }}>
          {busy && <span className="spinner" />}
          {inviteRole === 'accountant' ? 'Grant access' : 'Send invite'}
        </button>
      </form>

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
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Everything captured at sign-up is editable here except how they heard
  // about us — that's a one-time answer about a moment that's passed.
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth || '');
  const [phone, setPhone] = useState(user.phone || '');
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

  // One page of eight stacked cards means scrolling past billing to change a
  // password. The tabs are the same sections, one area at a time, and the tab
  // lives in the URL so "go to billing" can link straight to it.
  const tabs = [
    { id: 'profile', label: 'Profile', icon: 'user' },
    ...(user.role === 'owner'
      ? [
          { id: 'billing', label: 'Plan & billing', icon: 'credit-card' },
          { id: 'family', label: 'Family & access', icon: 'users' },
        ]
      : []),
    { id: 'security', label: 'Email & password', icon: 'shield' },
    { id: 'preferences', label: 'Preferences', icon: 'settings' },
  ];

  const requested = searchParams.get('tab');
  const tab = tabs.some((t) => t.id === requested) ? requested : 'profile';
  const active = tabs.find((t) => t.id === tab);

  function selectTab(id) {
    setSearchParams(id === 'profile' ? {} : { tab: id }, { replace: true });
  }

  return (
    <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Account settings</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Update your details, password, and how you sign in.</p>
      </div>

      <div
        role="tablist"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: 4,
          borderRadius: 'var(--radius)',
          background: 'var(--bg-inset)',
          border: '1px solid var(--border)',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => selectTab(t.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '8px 13px',
              borderRadius: 8,
              border: 0,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: t.id === tab ? 'var(--text)' : 'var(--text-muted)',
              background: t.id === tab ? 'var(--bg-elevated)' : 'transparent',
              boxShadow: t.id === tab ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        {tab === 'profile' && user.role === 'accountant' && <StartOwnAccount />}
        {tab === 'profile' && <AvatarSection user={user} setUser={setUser} />}

        {tab === 'billing' && <BillingSection user={user} />}
        {tab === 'family' && <FamilySection user={user} />}

      <form
        onSubmit={onSaveProfile}
        className="card"
        style={{ padding: 20, display: tab === 'profile' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}
      >
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

        {/* Read-only here on purpose: the sign-in address only moves once the
            new one has been proved, which is what the Email & password tab
            does. Editing it inline would look like it had worked. */}
        <div>
          <label className="label">Email</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input className="input" type="email" value={user.email} readOnly disabled style={{ flex: 1, minWidth: 200 }} />
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12.5, padding: '8px 13px' }}
              onClick={() => selectTab('security')}
            >
              Change email
            </button>
          </div>
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

        {tab === 'security' && user.role === 'owner' && <ChangeEmailSection user={user} />}

      <form
        onSubmit={onSavePassword}
        className="card"
        style={{ padding: 20, display: tab === 'security' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}
      >
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

      <div className="card" style={{ padding: 20, display: tab === 'security' ? 'block' : 'none' }}>
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

        {tab === 'preferences' && (
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
        )}
      </motion.div>
    </div>
  );
}
