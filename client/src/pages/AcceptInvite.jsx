import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

// Two quite different invitations arrive at this page.
//
// A family member already has a login waiting for them — the account holder's
// invitation created one — so all that is left is a password.
//
// An accountant has nothing yet. The invitation is only an offer, and accepting
// it is what creates their login, so they are asked for the things a person
// acting for clients needs: who they are, the firm they practise under, and a
// password. The page asks the server which kind this is before showing either.

export default function AcceptInvite() {
  const { acceptInvite, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [invite, setInvite] = useState(null);
  const [checking, setChecking] = useState(true);
  const [problem, setProblem] = useState(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [practiceName, setPracticeName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // An accountant invitation is a row of its own; a family one is not. A 404
  // here therefore means "this is the family kind", not "this is broken" — the
  // old flow still handles those and is left alone on purpose.
  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .get(`/auth/accountant-invite/check?token=${encodeURIComponent(token)}`)
      .then((res) => {
        setInvite(res.data);
        const [first = '', ...rest] = String(res.data.name || '').split(' ');
        setFirstName(first);
        setLastName(rest.join(' '));
      })
      .catch((err) => {
        if (err.message === 'expired' || err.message === 'already_accepted') setProblem(err.message);
      })
      .finally(() => setChecking(false));
  }, [token]);

  async function acceptAsFamily(e) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast('Passwords do not match', 'error');
      return;
    }
    setBusy(true);
    try {
      await acceptInvite(token, password);
      toast('Welcome to Taxify!', 'success');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function acceptAsAccountant(e) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast('Passwords do not match', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/accountant-invite/accept', {
        token,
        firstName,
        lastName,
        practiceName,
        phone,
        password,
      });
      await refresh();
      toast(`You can now open ${invite.inviterName}'s books`, 'success');
      navigate('/clients');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Invalid invitation" subtitle="This link is missing its token.">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 600 }}>
            Back to login
          </Link>
        </p>
      </AuthLayout>
    );
  }

  if (checking) {
    return <AuthLayout title="One moment" subtitle="Checking your invitation…" />;
  }

  // Said plainly, with what to do next, rather than a dead link and silence.
  if (problem) {
    return (
      <AuthLayout
        title={problem === 'expired' ? 'This invitation has expired' : 'This invitation has been used'}
        subtitle={
          problem === 'expired'
            ? 'Invitations last 24 hours. Ask your client to send another — it takes them one click.'
            : 'It has already been accepted. Sign in and the client will be on your list.'
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 600 }}>
            Go to sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  // Somebody who already has a Taxify login. Nothing to create, and nothing on
  // this page may write to their account — an invitation proves control of a
  // mailbox and that is not enough to set a password on an existing login.
  if (invite?.hasAccount) {
    return (
      <AuthLayout
        title="You already have a Taxify account"
        subtitle={`Sign in with ${invite.email} and ${invite.inviterName} will be on your client list.`}
      >
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/login')}>
          Go to sign in
        </button>
      </AuthLayout>
    );
  }

  const passwordFields = (
    <>
      <div>
        <label className="label">Password</label>
        <input
          className="input"
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          8+ characters, with an uppercase letter, a lowercase letter, and a number.
        </p>
      </div>
      <div>
        <label className="label">Confirm password</label>
        <input
          className="input"
          required
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
    </>
  );

  if (!invite) {
    return (
      <AuthLayout title="Set your password" subtitle="Finish creating your account to accept the invitation.">
        <form onSubmit={acceptAsFamily} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {passwordFields}
          <button className="btn btn-primary" disabled={busy} type="submit" style={{ marginTop: 8 }}>
            {busy && <span className="spinner" />}
            Activate my account
          </button>
        </form>
      </AuthLayout>
    );
  }

  const scope = invite.financialYears
    ? `the financial ${invite.financialYears.length === 1 ? 'year' : 'years'} ${invite.financialYears.join(', ')}`
    : 'their full history';
  const window = invite.windowHours === 24 ? '24 hours' : `${invite.windowHours / 24} days`;

  return (
    <AuthLayout
      title={`${invite.inviterName} has asked you to look at their books`}
      subtitle="Setting up your accountant login takes a moment. One login covers every client you act for."
    >
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-inset)',
          border: '1px solid var(--border)',
          fontSize: 12.5,
          lineHeight: 1.6,
          marginBottom: 18,
        }}
      >
        You will be able to read and export {scope}, for {window} from the first time you open their books. You can
        never change anything, and they can end it at any time.
      </div>

      <form onSubmit={acceptAsAccountant} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">First name</label>
            <input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="label">Last name</label>
            <input className="input" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Practice or firm name</label>
          <input
            className="input"
            required
            maxLength={160}
            placeholder="e.g. Chen & Co"
            value={practiceName}
            onChange={(e) => setPracticeName(e.target.value)}
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Your clients see this, so they know who they have shared their books with.
          </p>
        </div>
        <div>
          <label className="label">Phone (optional)</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {passwordFields}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
          By continuing you agree to the{' '}
          <Link to="/terms" target="_blank" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link to="/privacy" target="_blank" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Privacy Policy
          </Link>
          .
        </p>
        <button className="btn btn-primary" disabled={busy} type="submit" style={{ marginTop: 4 }}>
          {busy && <span className="spinner" />}
          Create my accountant login
        </button>
      </form>
    </AuthLayout>
  );
}
