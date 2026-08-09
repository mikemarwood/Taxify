import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { api } from '../lib/api.js';
import PasswordFields, { isStrongPassword } from '../components/PasswordFields.jsx';
import { nameProblem, companyProblem } from '../lib/inviteFields.js';
import { useAuth } from '../lib/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
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

// A link that has nothing left to do, said properly.
//
// These three outcomes were a line of grey text and a link to the login page,
// which reads as a failure whichever one you landed on — including the two that
// are not failures at all. Somebody clicking their own invitation a second time
// has done nothing wrong and needs a door, not an apology.
function Outcome({ tone, icon, title, body, action, to, secondary }) {
  const colour = tone === 'bad' ? 'var(--red)' : tone === 'good' ? 'var(--emerald)' : 'var(--accent)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
      {/* A ring rather than a bare glyph: at this size a lone icon reads as a
          decoration on an error, and the ring makes it the subject. */}
      <span
        style={{
          width: 74,
          height: 74,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colour,
          background: tone === 'bad' ? 'rgba(192, 42, 29, .1)' : tone === 'good' ? 'rgba(12, 115, 67, .1)' : 'var(--accent-soft)',
          border: `2px solid ${colour}`,
        }}
      >
        <Icon name={icon} size={34} strokeWidth={1.6} />
      </span>

      <div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 380 }}>{body}</div>
      </div>

      {to && (
        <Link to={to} className="btn btn-primary" style={{ width: '100%', textDecoration: 'none', justifyContent: 'center' }}>
          {action}
        </Link>
      )}

      {secondary && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 380 }}>{secondary}</div>
      )}
    </div>
  );
}

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

  // Only complained about once something has been typed, so an untouched
  // form is not covered in red before anyone has done anything wrong.
  const firstProblem = firstName.trim() ? nameProblem(firstName, 'First name') : '';
  const lastProblem = lastName.trim() ? nameProblem(lastName, 'Last name') : '';
  const practiceProblem = practiceName.trim() ? companyProblem(practiceName) : '';
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const canSubmit =
    !nameProblem(firstName, 'First name') &&
    !nameProblem(lastName, 'Last name') &&
    // Required here, unlike on the invitation, where the client may not know
    // the firm's name. The server refuses anything shorter than two either way.
    Boolean(practiceName.trim()) &&
    !practiceProblem &&
    isStrongPassword(password) &&
    passwordsMatch &&
    !busy;

  // The family flow has no name or practice fields — only the password pair.
  const canSubmitFamily = isStrongPassword(password) && passwordsMatch && !busy;

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
        // The parts if the client typed them, otherwise split the one name
        // older invitations carry. Fixed either way — see the note on the
        // fields themselves.
        if (res.data.firstName || res.data.lastName) {
          setFirstName(res.data.firstName || '');
          setLastName(res.data.lastName || '');
        } else {
          const [first = '', ...rest] = String(res.data.name || '').split(' ');
          setFirstName(first);
          setLastName(rest.join(' '));
        }
        if (res.data.practiceName) setPracticeName(res.data.practiceName);
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

  // One press. Nothing is created, nothing is typed — the account already
  // exists and the invitation carries everything else.
  async function accept() {
    setBusy(true);
    try {
      await api.post('/auth/accountant-invite/accept', { token });
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
      <AuthLayout title="That link is incomplete">
        <Outcome
          tone="bad"
          icon="ban"
          title="Something was lost on the way here"
          body="The link has no invitation on it. Email clients sometimes break a long link across two lines — try
                opening it from the email again rather than copying it."
          action="Go to sign in"
          to="/login"
        />
      </AuthLayout>
    );
  }

  if (checking) {
    return <AuthLayout title="One moment" subtitle="Checking your invitation…" />;
  }

  // Said plainly, with what to do next, rather than a dead link and silence.
  if (problem === 'expired') {
    return (
      <AuthLayout title="This invitation has expired">
        <Outcome
          tone="bad"
          icon="clock"
          title="It ran out before it was opened"
          body="An invitation to read somebody's financial records only lasts 24 hours, so one sitting in a mailbox
                cannot be used weeks later."
          action="Go to sign in"
          to="/login"
          secondary="Ask your client to send another — it is one click from their account page, and they have already
                     been told this one lapsed."
        />
      </AuthLayout>
    );
  }

  // Already used. Not a failure, and it should not read as one — this is
  // somebody clicking their own link a second time, which is an ordinary thing
  // to do. Before this they were shown a password box for an account they
  // already had.
  if (problem === 'already_accepted') {
    return (
      <AuthLayout title="You have already accepted this">
        <Outcome
          tone="good"
          icon="check-circle"
          title="Your account is set up"
          body="This invitation has been accepted and your accountant login already exists. There is nothing left to
                create — sign in and the client will be on your list."
          action="Go to sign in"
          to="/login"
          secondary="Forgotten the password? Use “Forgot password” on the sign-in page — this link cannot set one."
        />
      </AuthLayout>
    );
  }

  // Somebody who already has a Taxify login. Nothing to create, and nothing on
  // this page may write to their account — an invitation proves control of a
  // mailbox and that is not enough to set a password on an existing login.
  if (invite?.hasAccount) {
    return (
      <AuthLayout title="You already have a Taxify account">
        <Outcome
          tone="good"
          icon="user"
          title={`${invite.email} is already registered`}
          body={`Nothing needs creating. Sign in as usual and ${invite.inviterName} will be on your client list —
                 your own books and plan are untouched.`}
          action="Go to sign in"
          to="/login"
          secondary="An invitation proves somebody controls a mailbox, which is not enough to set a password on an
                     account that already exists. That is why this page will not offer to."
        />
      </AuthLayout>
    );
  }

  // The same live checklist Activate and ResetPassword use. This page listed
  // the rule as a sentence and then let you submit a password that broke it,
  // so the first you knew was the server refusing it.
  const passwordFields = (
    <PasswordFields
      password={password}
      setPassword={setPassword}
      confirmPassword={confirmPassword}
      setConfirmPassword={setConfirmPassword}
    />
  );

  if (!invite) {
    return (
      <AuthLayout title="Set your password" subtitle="Finish creating your account to accept the invitation.">
        <form onSubmit={acceptAsFamily} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {passwordFields}
          <button className="btn btn-primary" disabled={!canSubmitFamily} type="submit" style={{ marginTop: 8 }}>
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

  // Signed in as the person the invitation is for.
  //
  // The page used to build them a login here — name, firm, password — from
  // details their client had typed. An invitation now only ever goes to an
  // address that already has a confirmed account, so there is nothing to
  // create: either they are signed in as that account and it is one press, or
  // they need to sign in first.
  const asThem = invite.signedInAs && invite.signedInAs.toLowerCase() === String(invite.email || '').toLowerCase();

  return (
    <AuthLayout
      title={`${invite.inviterName} would like to share their books with you`}
      subtitle={asThem ? 'One press and they are on your client list.' : `Sign in as ${invite.email} to accept.`}
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
        You will be able to {invite.canWrite ? 'read, add and edit' : 'read and export'} {scope}, for {window} from the
        first time you open their books. {invite.canWrite ? 'You can never delete their books. ' : 'You can never change anything. '}
        They can end it at any time.
      </div>

      {asThem ? (
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={accept}>
          {busy && <span className="spinner" />}
          Accept and add {invite.inviterName}
        </button>
      ) : (
        <>
          {/* Signed in as somebody else, or not at all. Said rather than left
              to be discovered by pressing a button that refuses — an
              invitation belongs to one address and only that address can take
              it. */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '11px 13px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--accent)',
              background: 'var(--bg-subtle)',
              marginBottom: 14,
            }}
          >
            <Icon name="user" size={15} style={{ color: 'var(--accent)', marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-muted)' }}>
              {invite.signedInAs
                ? `You are signed in as ${invite.signedInAs}. This invitation was sent to ${invite.email}, and only that account can accept it.`
                : `This invitation was sent to ${invite.email}. Sign in with that account and open this link again.`}
            </span>
          </div>
          <Link
            to={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
            className="btn btn-primary"
            style={{ width: '100%', textDecoration: 'none', justifyContent: 'center' }}
          >
            {invite.signedInAs ? 'Sign in as somebody else' : 'Go to sign in'}
          </Link>
        </>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '16px 0 0', lineHeight: 1.6 }}>
        Nothing is shared until you accept, and this link stops working 24 hours after it was sent. If you were not
        expecting it, close this page — nobody has been given anything.
      </p>
    </AuthLayout>
  );
}
