import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import Icon from './Icon.jsx';

// Acting for other people's books, as a switch rather than a side effect.
//
// It was never something you chose. isAccountant meant "has at least one live
// assignment", so you became an accountant by being invited and stopped being
// one when the last client's access lapsed — which is fine for somebody who
// only ever acts for others, and no use to an ordinary account holder who also
// does the books for a relative. There was nothing they could turn on.
//
// It sits with the plan because that is where somebody goes to decide what
// their account is, and because the two questions are adjacent: which plan you
// pay for, and whether this login also reads other people's records.
export default function ActsForClientsCard({ user }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  // isAccountant, not the stored flag.
  //
  // The flag is only one of the three ways to be an accountant — the other two
  // are holding a client and having the role. Reading it alone meant somebody
  // who became an accountant by accepting an invitation saw this card offering
  // to turn on a thing they had been doing for months, and no way at all to
  // turn it off. The switch has to show the state somebody is actually in
  // before it can offer to change it.
  //
  // Turning it off from here still goes through the same guard: it clears the
  // flag, and if a client or an invitation is what is making them an accountant
  // the server refuses and names it, which is the useful answer.
  const on = Boolean(user?.isAccountant);

  async function set(next) {
    const ok = await confirm({
      tone: next ? undefined : 'danger',
      title: next ? 'Act for clients on this account?' : 'Stop acting for clients?',
      body: next
        ? 'Clients will be able to share their books with you, and invitations will appear on your client list to accept or decline. Your own books are untouched. You will be asked for two-factor sign-in and a practice name before you can open anybody.'
        : 'Nobody will be able to share their books with you, and you will not be sent invitations. Your own books are untouched and you can turn it back on whenever you like.',
      confirmLabel: next ? 'Turn it on' : 'Turn it off',
      cancelLabel: 'Not now',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.post('/auth/accountant-role', { actsForClients: next });
      // The session decides what the sidebar offers and what the client list
      // will answer, so it is re-read before anything is said — the change is
      // done by the time the message appears rather than on the next reload.
      await refresh();
      toast(
        next ? 'You can now act for clients — check your email' : 'You no longer act for clients — check your email',
        'success'
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name="briefcase" size={18} style={{ color: on ? 'var(--accent)' : 'var(--text-muted)' }} />
        <span style={{ fontWeight: 700 }}>Acting for clients</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 9px',
            borderRadius: 999,
            color: on ? '#fff' : 'var(--text-muted)',
            background: on ? 'var(--accent)' : 'var(--bg-inset)',
            border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
          }}
        >
          {on ? 'On' : 'Off'}
        </span>
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
        {on
          ? 'Clients can share their books with you, and invitations appear on your client list. Your own books and plan are unaffected.'
          : 'Turn this on if you keep books for other people as well as your own. They share theirs with you, on this same login, and your own books and plan are unaffected.'}
      </p>

      {/* Said while it is on, not only when the press is refused. Somebody who
          wants to stop should know what is in the way before they try, and the
          two things in the way are the two things they can go and clear. */}
      {on && (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.55 }}>
          To turn it off, first decline or let go of every client, and make sure no invitation is waiting either way.
        </p>
      )}

      {/* Said before it is pressed rather than as a refusal afterwards. The two
          roles pull in opposite directions on one account: one reads other
          people's books, the other hands out sight of its own. */}
      {!on && (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.55 }}>
          An account that acts for clients cannot also share its books with an accountant, and this can only be
          changed while nothing is outstanding — no clients, no accountant on your own books, and no invitation
          waiting either way.
        </p>
      )}

      <button
        type="button"
        className={on ? 'btn btn-ghost' : 'btn btn-primary'}
        style={{ alignSelf: 'flex-start', fontSize: 13 }}
        disabled={busy}
        onClick={() => set(!on)}
      >
        {busy && <span className="spinner" />}
        {on ? 'Stop acting for clients' : 'Act for clients'}
      </button>
    </div>
  );
}
