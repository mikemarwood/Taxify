import { useEffect, useState } from 'react';
import { onCasedInput } from '../lib/casedInput.js';
import StartOwnAccount from '../components/StartOwnAccount.jsx';
import { titleCaseLive } from '../lib/textCase.js';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import { formatMoney } from '../lib/money.js';
import { playClick } from '../lib/sounds.js';
import { formatDateShort } from '../lib/dates.js';

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
    <div className="card" style={{ padding: 22, marginBottom: 22, borderLeft: '4px solid var(--amber)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="lock" size={19} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            One step before you can open a client's books
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
            You are about to read somebody else's complete financial records. That is a higher bar than an ordinary
            sign-in, and the people whose records they are did not get a say in it.
          </p>

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
  const { user, refresh, logout } = useAuth();
  // What they still have to do. Sent with every /auth/me, so it is already here.
  const setup = user?.accountantSetup;
  const blocked = setup && !setup.ready;
  const navigate = useNavigate();
  const toast = useToast();
  const [clients, setClients] = useState(null);
  const [windowHours, setWindowHours] = useState(24);
  const [opening, setOpening] = useState(null);
  // Whether the plan question has taken over the empty-state card.
  const [startingOwn, setStartingOwn] = useState(false);

  useEffect(() => {
    api
      .get('/auth/clients')
      .then((res) => {
        setClients(res.data.clients);
        setWindowHours(res.data.windowHours || 24);
      })
      .catch((err) => {
        toast(err.message, 'error');
        setClients([]);
      });
  }, [toast]);

  // Being invited to read someone else's books says nothing about whether you
  // keep your own. This turns the same login into an ordinary account holder —
  // trial, plans and all — without losing a single client.
  async function open(client) {
    playClick();
    setOpening(client.ownerId);
    try {
      await api.post(`/auth/clients/${client.ownerId}`);
      await refresh();
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
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

        {blocked && <SetupRequired missing={setup.missing} onDone={refresh} />}

        {clients === null ? (
          <SkeletonList rows={3} />
        ) : clients.length === 0 ? (
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
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
                      <span
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          background: 'var(--accent-soft)',
                          border: '1px solid var(--accent-ring)',
                          color: 'var(--accent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Icon name="briefcase" size={22} />
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
        )}
      </div>
    </div>
  );
}
