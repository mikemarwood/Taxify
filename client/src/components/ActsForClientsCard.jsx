import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { onCasedInput } from '../lib/casedInput.js';
import { titleCaseLive } from '../lib/textCase.js';
import Icon from './Icon.jsx';

// Becoming an accountant, as a switch rather than a side effect.
//
// It was never something anybody chose. isAccountant meant "has at least one
// live assignment", so you became one by being invited and stopped being one
// when the last client's access lapsed — fine for somebody who only ever acts
// for others, and no use to an account holder who also keeps the books for a
// relative. There was nothing they could turn on.
//
// It sits with the plan because that is where somebody decides what their
// account is, and because the two questions are adjacent: which plan you pay
// for, and whether this login also reads other people's records.
export default function ActsForClientsCard({ user }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  // The firm name is asked for here rather than after the fact.
  //
  // It is required before anybody's books can be opened, and it used to be
  // demanded at exactly that moment — on the client list, in a panel that
  // appears because you pressed a client and were refused. Which is the worst
  // time to ask: you are there to do a job and are instead filling in a profile
  // field. Asked here it is one form, once, at the moment somebody has decided
  // to do this.
  const [practice, setPractice] = useState(user?.practiceName || '');
  const needsPractice = !String(user?.practiceName || '').trim();

  // isAccountant, not the stored flag. The flag is only one of the three ways
  // to be one — the others are holding a client and having the role — so
  // reading it alone showed somebody who became an accountant by accepting an
  // invitation a card offering to turn on what they had been doing for months.
  const on = Boolean(user?.isAccountant);
  const ready = !needsPractice || practice.trim().length >= 2;

  async function set(next) {
    if (next && !ready) return;

    const ok = await confirm({
      tone: next ? undefined : 'danger',
      title: next ? 'Become an accountant on this account?' : 'Stop being an accountant?',
      body: next
        ? 'Clients will be able to share their books with you, and invitations will appear on your client list to accept or decline. Your own books, plan and everything in them are untouched.'
        : 'Nobody will be able to share their books with you, and you will not be sent invitations. Your own books are untouched and you can turn it back on whenever you like.',
      confirmLabel: next ? 'Become an accountant' : 'Turn it off',
      cancelLabel: 'Not now',
    });
    if (!ok) return;

    setBusy(true);
    try {
      // The firm name first, so the switch never goes on without one. If this
      // fails there is nothing to undo, which is the right way round — the
      // other order would leave somebody an accountant with no name to show
      // their clients.
      if (next && needsPractice) {
        await api.patch('/auth/profile', { practiceName: practice.trim() });
      }
      await api.post('/auth/accountant-role', { actsForClients: next });
      // The session decides what the sidebar offers and what the client list
      // answers, so it is re-read before anything is said — the change is done
      // by the time the message appears rather than on the next reload.
      await refresh();
      toast(
        next ? 'You are an accountant now — check your email' : 'You are no longer an accountant — check your email',
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
        <span style={{ fontWeight: 700 }}>{on ? 'You are an accountant' : 'Become an accountant'}</span>
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

      {/* Asked before the press, not after it. Clients see this name when they
          decide whether they have shared with the right person, so it is not a
          detail to fill in later — and it is required before any of their books
          will open. */}
      {!on && needsPractice && (
        <div>
          <label className="label" htmlFor="acct-practice">
            Your practice or firm name
          </label>
          <input
            id="acct-practice"
            className="input"
            maxLength={160}
            placeholder="e.g. Chen & Co"
            value={practice}
            onChange={onCasedInput(titleCaseLive, setPractice)}
            style={{ maxWidth: 340 }}
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
            Shown to clients who share their books with you, so they know who they have shared with. Use your own name
            if you do not trade under one.
          </div>
        </div>
      )}

      {/* Said while it is on, not only when the press is refused. Somebody who
          wants to stop should know what is in the way before they try, and the
          two things in the way are the two things they can go and clear. */}
      {on ? (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.55 }}>
          To turn it off, first decline or let go of every client, and make sure no invitation is waiting either way.
        </p>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.55 }}>
          An accountant cannot also share their own books with somebody else, and you will be asked to turn on
          two-factor sign-in before you can open a client.
        </p>
      )}

      <button
        type="button"
        className={on ? 'btn btn-ghost' : 'btn btn-primary'}
        style={{ alignSelf: 'flex-start', fontSize: 13 }}
        disabled={busy || (!on && !ready)}
        onClick={() => set(!on)}
      >
        {busy && <span className="spinner" />}
        {on ? 'Stop being an accountant' : 'Become an accountant'}
      </button>

      {!on && !ready && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -4 }}>
          Enter your practice or firm name first.
        </div>
      )}
    </div>
  );
}
