import { useEffect, useState } from 'react';
import { describeHours } from '../lib/accessWindow.js';
import InviteCountdown from '../components/InviteCountdown.jsx';
import { onCasedInput } from '../lib/casedInput.js';
import StartOwnAccount from '../components/StartOwnAccount.jsx';
import { titleCaseLive } from '../lib/textCase.js';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import { formatMoney } from '../lib/money.js';
import { playClick } from '../lib/sounds.js';
import { formatDateShort, formatDateLong } from '../lib/dates.js';

function formatDate(value) {
  if (!value) return null;
  return formatDateShort(value, null);
}

// How long is left before this client's window closes, in the words someone
// would use out loud.
function remaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
  const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
}

// One step between an accountant and their clients, and the fix for it is on
// the same page. Anything that sends somebody off to hunt through settings for
// a switch they have never heard of is a wall, not a prompt.
function SetupRequired({ missing, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { setOtpEnabled, refresh } = useAuth();
  const [practice, setPractice] = useState('');
  const [busy, setBusy] = useState(false);

  async function enableMfa() {
    setBusy(true);
    try {
      await setOtpEnabled(true);
      toast('Two-factor is on — you will be sent a code each time you sign in', 'success');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function savePractice(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/auth/profile', { practiceName: practice.trim() });
      await refresh();
      toast('Saved', 'success');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    // Blue, not --amber. That token is #9a5b06, a brown, and this is an
    // instruction rather than a warning — nothing has gone wrong, there is
    // simply a step left.
    <div className="card" style={{ padding: 22, marginBottom: 22, borderLeft: '4px solid var(--accent)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="lock" size={19} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            One step before you can open a client's books
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
            You are about to read somebody else's complete financial records. That is a higher bar than an ordinary
            sign-in, and the people whose records they are did not get a say in it.
          </p>

          {missing.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>
              Check two-factor sign-in is on and your practice name is filled in under{' '}
              <Link to="/account" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                My account
              </Link>
              .
            </p>
          )}

          {missing.includes('mfa') && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>Turn on two-factor sign-in</div>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
                We will email you a six-digit code each time you sign in. Nothing to install.
              </p>
              <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy} onClick={enableMfa}>
                {busy && <span className="spinner" />}
                Turn it on
              </button>
            </div>
          )}

          {missing.includes('profile') && (
            <form onSubmit={savePractice}>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>Add your practice or firm name</div>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
                Your clients see it, so they know who they have shared their books with.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  maxLength={160}
                  required
                  value={practice}
                  placeholder="e.g. Chen & Co"
                  onChange={onCasedInput(titleCaseLive, setPractice)}
                  style={{ maxWidth: 280 }}
                />
                <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy || !practice.trim()}>
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Where an accountant lands. An accountant may act for several people, so the
// first question is always whose books — never assumed, even when there is only
// one, because opening a client is what starts their 24-hour window.
export default function ClientPicker() {
  // useConfirm, not the browser. Without it `confirm` resolves to
  // window.confirm — a global, so nothing complains — and passing it an
  // options object gave a native grey box reading [object Object].
  const confirm = useConfirm();
  const { user, refresh, logout } = useAuth();
  // What they still have to do. Sent with every /auth/me, so it is already here.
  // What the session last told us is outstanding, and what the server said
  // when we actually tried.
  //
  // These can disagree. The user object is fetched once at sign-in, so an
  // account that was fine then and is not now — a practice name cleared, or
  // two-factor turned off in another tab — reads as ready here while the door
  // refuses. That is how a card stayed pressable and answered with a machine
  // code: the page had no idea anything was wrong until the server said so.
  const [refused, setRefused] = useState(null);
  const setup = user?.accountantSetup;
  const blocked = (setup && !setup.ready) || Boolean(refused);
  const missing = refused || setup?.missing || [];
  const navigate = useNavigate();
  const toast = useToast();
  const [clients, setClients] = useState(null);
  const [windowHours, setWindowHours] = useState(24);
  const [opening, setOpening] = useState(null);
  // Whether the plan question has taken over the empty-state card.
  const [startingOwn, setStartingOwn] = useState(false);
  // Invitations sent to this address that nobody has accepted yet.
  const [invitations, setInvitations] = useState([]);
  // Which invitation is mid-answer, so both its buttons go quiet rather than
  // only the one that was pressed.
  const [answering, setAnswering] = useState(null);

  function load() {
    api
      .get('/auth/clients')
      .then((res) => {
        setClients(res.data.clients);
        setInvitations(res.data.invitations || []);
        setWindowHours(res.data.windowHours || 24);
      })
      .catch((err) => {
        toast(err.message, 'error');
        setClients([]);
      });
  }

  useEffect(() => {
    load();

    // An invitation runs out while somebody is looking at it, and the countdown
    // on the card reaching zero is not the same as the server having swept it.
    // Reading again on return to the tab keeps the two honest without a poll
    // that would run all day for an event that happens once.
    function onVisible() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Being invited to read someone else's books says nothing about whether you
  // keep your own. This turns the same login into an ordinary account holder —
  // trial, plans and all — without losing a single client.
  // Answering an invitation.
  //
  // Declining asks first. Accepting does not: it is the thing they came here to
  // do, it is reversible from the other side at any moment, and a dialog in
  // front of the expected answer is a dialog people learn to click through.
  // Declining is the one that cannot be undone from here — the invitation is
  // closed and only the client can send another.
  async function answer(invite, accept) {
    if (!accept) {
      const ok = await confirm({
        tone: 'danger',
        title: `Decline ${invite.from}?`,
        body: 'They will be told, and the invitation is closed. Only they can send another one.',
        confirmLabel: 'Decline it',
        cancelLabel: 'Keep it',
      });
      if (!ok) return;
    }
    setAnswering(invite.id);
    try {
      await api.post(`/auth/accountant-invites/${invite.id}/${accept ? 'accept' : 'decline'}`);
      if (accept) playClick();
      toast(accept ? `${invite.from} is on your client list` : 'Invitation declined', 'success');
      // Refetched rather than spliced out: accepting turns an invitation into a
      // client, and the card that replaces it is built from figures only the
      // server has.
      load();
      // And the session, which accepting has just changed the meaning of.
      //
      // isAccountant is "has at least one client", so the first acceptance
      // flips it — and with it the requirement to have two-factor on and a
      // firm name before opening anybody's books. Without this the browser
      // still held the old answer, so the card looked pressable, the door
      // refused, and the refusal arrived as a machine code.
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAnswering(null);
    }
  }

  async function open(client) {
    playClick();
    setOpening(client.ownerId);
    try {
      await api.post(`/auth/clients/${client.ownerId}`);
      await refresh();
      navigate('/');
    } catch (err) {
      // The door refusing for want of setup is not an error to toast and
      // forget. It is the one refusal with something to do about it, so the
      // page raises the panel that says what and offers the way to fix it.
      if (err.code === 'accountant_setup_required') {
        setRefused(err.missing || []);
        // The session was stale by definition if we got here — re-read it, so
        // the moment they finish the setup the cards come back to life without
        // a reload.
        refresh();
      } else {
        toast(err.message, 'error');
      }
      setOpening(null);
    }
  }

  return (
    /* Layout brings its own background and padding, so this no longer
       builds a second full-height page inside it. */
    <div>
      <div style={{ maxWidth: 900 }}>
        {/* A page heading like every other page has now.
            The logo, "Signed in as …", and a row of buttons — Start my own
            account, My details, Sign out — were all here because this page
            rendered outside Layout with no navigation of any kind. With the
            sidebar beside it, every one of them was a second copy of something
            already on screen a few inches to the left. */}
        {/* The heading changes with the question being asked.
            "Your clients — choose whose books to open" sat above a plan
            chooser, telling somebody to do one thing while the page asked them
            another. It is the same page and the same card either way; only
            what it is for has changed. */}
        <div style={{ marginBottom: 26 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 25 }}>
            {startingOwn ? 'Choose your plan' : 'Your clients'}
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
            {startingOwn ? (
              'Your clients stay exactly as they are — this adds books of your own on the same login.'
            ) : (
              <>
                Choose whose books to open — access is read-only and lasts {windowHours} hours from the first time
                you open each one.
              </>
            )}
          </p>
        </div>

        {blocked && (
          <SetupRequired
            missing={missing}
            onDone={() => {
              setRefused(null);
              refresh();
            }}
          />
        )}

        {clients === null ? (
          <SkeletonList rows={3} />
        ) : clients.length === 0 && invitations.length === 0 ? (
          /* Choosing a plan takes the card over rather than opening inside it.
             It was appearing underneath "No clients have shared their books
             with you", centred, beside a link about passwords — so the page
             went on explaining an empty client list while asking which plan to
             start on. Two subjects at once, and the question did not read as
             the thing being answered. */
          <div className="card" style={{ padding: 40, textAlign: startingOwn ? 'left' : 'center' }}>
            {!startingOwn && (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-muted)' }}>
                  <Icon name="briefcase" size={30} />
                </div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>No clients have shared their books with you</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 6px', lineHeight: 1.6 }}>
                  Access is granted from the client's own account, under Accountant access. It also ends on its own{' '}
                  {windowHours} hours after you first open it, so an old client may simply need to share it again.
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 18px', lineHeight: 1.6 }}>
                  Until then there is nothing here to open. You can still change your own name, password, email
                  address and sign-in settings.
                </p>
              </>
            )}

            {/* One element, mounted whether the plan question is open or
                shut. It used to appear in both halves of a ternary on the
                very state it sets, so pressing it unmounted the instance
                that knew it was open and mounted a fresh, closed one — the
                press swapped which copy was on screen and did nothing else.
                What changes with the state is the layout around it. */}
            <div
              style={
                startingOwn
                  ? { maxWidth: 720, margin: '0 auto' }
                  : { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }
              }
            >
              {!startingOwn && (
                <Link to="/account" className="btn btn-ghost" style={{ fontSize: 13 }}>
                  My details &amp; password
                </Link>
              )}
              {user?.role === 'accountant' && <StartOwnAccount onOpenChange={setStartingOwn} />}
            </div>
          </div>
        ) : (
          <>
            {/* One area for everybody who has asked, whether or not it has been
                accepted yet. They were two lists: a strip of invitations above
                and the clients below, which is our filing rather than anything
                about them — the question on this page is "whose books can I
                get to", and an invitation is the same question with a step
                still to go. The card says which it is. */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Clients who share their books with you</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {clients.length} open
                {invitations.length > 0 &&
                  ` · ${invitations.length} waiting on you`}
              </span>
            </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {/* Waiting ones first: they are the only thing on this page with
                something left to do. Dashed and amber, so it reads as not-yet
                rather than as a client that will not open. */}
            {invitations.map((invite, i) => (
              <motion.div
                key={`invite-${invite.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.04 }}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  // Dashed to read as not-yet, in the page's own blue. It was
                  // --amber, which is #9a5b06 — a brown, and a muddy one beside
                  // everything else on the page.
                  borderStyle: 'dashed',
                  borderColor: 'var(--accent-ring)',
                }}
              >
                <div
                  style={{
                    padding: '7px 14px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    color: 'var(--accent)',
                    background: 'var(--accent-soft)',
                    borderBottom: '1px solid var(--border)',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Icon name="clock" size={12} />
                    Waiting for you to answer
                  </span>
                  {/* The clock, not a date. "Expires 3 September" does not tell
                      somebody whether they have a fortnight or an afternoon, and
                      this is exactly the sort of decision people put off. */}
                  <InviteCountdown expiresAt={invite.expiresAt} onExpired={load} />
                </div>

                <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'var(--accent-soft)',
                        border: '1px dashed var(--accent-ring)',
                        color: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="mail" size={20} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          fontSize: 15.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {invite.from}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12.5,
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {invite.email}
                      </span>
                    </span>
                  </div>

                  {/* Answered here, not in the email.
                      The link used to be the whole of it: opening it granted
                      access. A link in an inbox is forwardable, and all it
                      proved was that the mail had reached a mailbox — not that
                      the right person was reading it. Being signed in as the
                      account holding that address proves the same thing and
                      more, because the address was confirmed at activation. */}
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    Their books stay shut to everybody until you accept. If you do nothing, the invitation runs out
                    on its own and they are told nobody answered.
                  </p>

                  <div
                    style={{
                      marginTop: 'auto',
                      paddingTop: 4,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 10,
                      fontSize: 11.5,
                      color: 'var(--text-subtle)',
                    }}
                  >
                    <span>{invite.canWrite ? 'Read and write' : 'Read-only'}</span>
                    <span>{describeHours(invite.windowHours)} once opened</span>
                    <span>Expires {formatDateLong(invite.expiresAt)}</span>
                  </div>

                  {/* Both go quiet while either is working, so a slow network
                      cannot have somebody accept and decline the same
                      invitation. */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: 12.5, flex: '1 1 auto', justifyContent: 'center' }}
                      disabled={answering === invite.id}
                      onClick={() => answer(invite, true)}
                    >
                      {answering === invite.id && <span className="spinner" />}
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12.5 }}
                      disabled={answering === invite.id}
                      onClick={() => answer(invite, false)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}

            {clients.map((c, i) => {
              const left = remaining(c.expiresAt);
              const busy = opening === c.ownerId;
              // Their plan has ended, so their books are shut to everybody
              // including us. The card stays — they should see who is on their
              // list — but it says why rather than refusing the press in
              // silence. It is the client's bill, so the card says so.
              const shut = Boolean(c.lapsed);
              return (
                <motion.button
                  key={c.ownerId}
                  type="button"
                  onClick={() => !opening && !blocked && !shut && open(c)}
                  disabled={!!opening || blocked || shut}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.04 }}
                  whileHover={opening ? undefined : { y: -3 }}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    textAlign: 'left',
                    cursor: opening ? 'default' : 'pointer',
                    font: 'inherit',
                    color: 'var(--text)',
                    display: 'flex',
                    flexDirection: 'column',
                    // Still visible while blocked — they should be able to see
                    // who is waiting for them, just not open it yet.
                    opacity: blocked || shut ? 0.55 : opening && !busy ? 0.5 : 1,
                  }}
                >
                  {shut && (
                    <div
                      style={{
                        padding: '7px 14px',
                        fontSize: 11.5,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        color: 'var(--red)',
                        background: 'var(--bg-inset)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <Icon name="lock" size={12} />
                      Their plan has ended — ask them to start one before you can open this
                    </div>
                  )}
                  <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {/* Their own face where they have one. A client list
                          of identical briefcases is a list you read rather
                          than recognise; Avatar falls back to initials, so
                          the card is never empty. */}
                      <Avatar name={c.businessName || c.name} avatarUrl={c.avatarUrl} size={44} />
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: 'block',
                            fontWeight: 700,
                            fontSize: 15.5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.businessName || c.name}
                        </span>
                        <span
                          style={{
                            display: 'block',
                            fontSize: 12.5,
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.businessName ? `${c.name} · ${c.email}` : c.email}
                        </span>
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>Expenses</span>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{c.expenseCount}</span>
                      </span>
                      <span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>Total</span>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{formatMoney(c.totalAmount)}</span>
                      </span>
                    </div>

                    {/* What they were actually given — a partial grant looks
                        identical to a full one until it's said out loud. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 11.5,
                          fontWeight: 600,
                          padding: '3px 9px',
                          borderRadius: 999,
                          background: 'var(--bg-inset)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <Icon name="chart" size={12} />
                        {c.financialYears ? `FY ${c.financialYears.join(', ')}` : 'All financial years'}
                      </span>
                      {c.latestExpense && (
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', alignSelf: 'center' }}>
                          Latest {formatDate(c.latestExpense)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px 18px',
                      borderTop: '1px solid var(--border)',
                      background: left ? 'var(--bg-inset)' : 'var(--accent-soft)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: left ? 'var(--text-muted)' : 'var(--accent)',
                    }}
                  >
                    {busy ? (
                      <>
                        <span className="spinner" />
                        Opening…
                      </>
                    ) : left ? (
                      <>
                        <Icon name="lock" size={13} />
                        Window open · {left}
                      </>
                    ) : (
                      <>
                        <Icon name="pointer" size={13} />
                        Open these books — starts the {windowHours}-hour window
                      </>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
