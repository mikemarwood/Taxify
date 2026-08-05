import { useEffect, useState } from 'react';
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

// Where an accountant lands. An accountant may act for several people, so the
// first question is always whose books — never assumed, even when there is only
// one, because opening a client is what starts their 24-hour window.
export default function ClientPicker() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [clients, setClients] = useState(null);
  const [windowHours, setWindowHours] = useState(24);
  const [opening, setOpening] = useState(null);
  const [starting, setStarting] = useState(false);

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
  async function startOwnAccount() {
    setStarting(true);
    try {
      await api.post('/auth/start-own-account');
      await refresh();
      toast('Your own account is ready — your 14-day trial has started', 'success');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
      setStarting(false);
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
      toast(err.message, 'error');
      setOpening(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '40px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 26 }}>
          <img src="/logo.svg" alt="Taxify" width="40" height="40" />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 style={{ margin: '0 0 4px', fontSize: 25 }}>Your clients</h1>
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
              Signed in as {user?.name}. Choose whose books to open — access is read-only and lasts {windowHours} hours
              from the first time you open each one.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 13 }}
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>

        {clients === null ? (
          <SkeletonList rows={3} />
        ) : clients.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-muted)' }}>
              <Icon name="briefcase" size={30} />
            </div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No clients have shared their books with you</div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 6px', lineHeight: 1.6 }}>
              Access is granted from the client's own account, under Family &amp; access. It also ends on its own{' '}
              {windowHours} hours after you first open it, so an old client may simply need to share it again.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 18px', lineHeight: 1.6 }}>
              Until then there is nothing here to open. You can still change your own name, password, email address
              and sign-in settings.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/account" className="btn btn-ghost" style={{ fontSize: 13 }}>
                My details &amp; password
              </Link>
              {/* An accountant invited to look at other people's books may want
                  Taxify for their own tax too — same login, ordinary account. */}
              {user?.role === 'accountant' && (
                <button type="button" className="btn btn-primary" style={{ fontSize: 13 }} onClick={startOwnAccount}>
                  {starting && <span className="spinner" />}
                  Start tracking my own expenses
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {clients.map((c, i) => {
              const left = remaining(c.expiresAt);
              const busy = opening === c.ownerId;
              return (
                <motion.button
                  key={c.ownerId}
                  type="button"
                  onClick={() => !opening && open(c)}
                  disabled={!!opening}
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
                    opacity: opening && !busy ? 0.5 : 1,
                  }}
                >
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
