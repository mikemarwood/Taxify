import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { useToast } from './Toast.jsx';
import { sentenceCase } from '../lib/text.js';
import { AttachmentPicker, MIN_MESSAGE, MAX_MESSAGE, messageProblem } from './SupportThread.jsx';

// Raising a ticket for somebody else.
//
// Every conversation started on the customer's side, which assumes every
// conversation does. They do not: somebody rings up, writes to a personal
// address, or an account has a problem before the person has noticed it. All
// of that was handled outside the system and summarised into it later, if at
// all — so what was actually said lived in somebody's memory.
//
// Held to the same rules as a ticket somebody raises themselves, and carrying
// the same things: attachments, a category, and who is going to answer it. A
// ticket we start is not a lesser one.

const MIN_SUBJECT = 3;
const MAX_SUBJECT = 150;

// What state their account is in, in two words, beside their name.
//
// Half of what support needs before writing is whether the person is on a
// trial, paying, or locked out — and picking the right Michael out of three is
// easier with it on screen than by opening each of them.
function statusOf(customer) {
  if (customer.accessBypass) return { label: 'Access granted', tone: 'var(--accent)' };
  switch (customer.subscriptionStatus) {
    case 'active':
      return { label: 'Active', tone: 'var(--emerald)' };
    case 'trialing':
      return { label: 'On trial', tone: 'var(--accent)' };
    case 'past_due':
      return { label: 'Payment failed', tone: 'var(--red)' };
    case 'canceled':
    case 'cancelled':
      return { label: 'Cancelled', tone: 'var(--red)' };
    default:
      return { label: 'No plan', tone: 'var(--text-muted)' };
  }
}

export default function NewTicketForSomebody({ categories, staff, currentUserId, isAdmin, onCreated, onCancel }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [searching, setSearching] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('other');
  const [message, setMessage] = useState('');
  const [assignTo, setAssignTo] = useState(currentUserId || '');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const box = useRef(null);

  // Debounced, and only once there is enough to be a search. One character
  // matches most of the table and tells nobody anything.
  useEffect(() => {
    const text = query.trim();
    if (chosen || text.length < 2) {
      setMatches([]);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get(`/admin/support/customers?q=${encodeURIComponent(text)}`)
        .then((res) => setMatches(res.data.customers || []))
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      setSearching(false);
    };
  }, [query, chosen]);

  // A typed address that matched nobody is still a valid thing to write to —
  // somebody who rang up before signing up is exactly who most needs it.
  const typedEmail = query.trim().toLowerCase();
  const emailLooksReal = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(typedEmail);
  const recipient = chosen?.email || (emailLooksReal ? typedEmail : null);

  const subjectTrimmed = subject.trim();
  const subjectProblem =
    subjectTrimmed.length === 0
      ? ''
      : subjectTrimmed.length < MIN_SUBJECT
      ? `The subject needs at least ${MIN_SUBJECT} characters`
      : '';
  const bodyProblem = message.trim() ? messageProblem(message) : '';

  const canSend =
    Boolean(recipient) && subjectTrimmed.length >= MIN_SUBJECT && !messageProblem(message) && !busy;

  async function send() {
    setBusy(true);
    try {
      let payload = {
        email: recipient,
        subject: subjectTrimmed,
        category,
        message: message.trim(),
        assignTo: assignTo || undefined,
      };
      if (files.length) {
        const form = new FormData();
        for (const [key, value] of Object.entries(payload)) if (value !== undefined) form.append(key, value);
        for (const file of files) form.append('attachments', file);
        payload = form;
      }

      const { data } = await api.post(
        '/admin/support/tickets',
        payload,
        files.length
          ? {
              onUploadProgress: (event) => {
                if (!event.total) return;
                setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
              },
            }
          : undefined
      );
      toast(
        data.isGuest
          ? `Raised as ${data.reference} — no account, so they were emailed a private link`
          : `Raised as ${data.reference} — they have been emailed`,
        'success'
      );
      onCreated?.(data.id);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name="mail" size={17} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>Start a conversation</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>

      {/* Who it is for. Searched as it is typed, by name or address, because
          whoever is on the phone will give you one or the other and rarely the
          one you expected. */}
      <div ref={box} style={{ position: 'relative' }}>
        <label className="label" style={{ fontSize: 11.5 }}>
          Who it is for
        </label>

        {chosen ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--accent)',
              background: 'var(--accent-soft)',
            }}
          >
            <Avatar name={chosen.name} avatarUrl={chosen.avatarUrl} size={30} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, display: 'block' }}>{chosen.name}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{chosen.email}</span>
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: statusOf(chosen).tone }}>
              {statusOf(chosen).label}
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11.5, padding: '4px 9px' }}
              disabled={busy}
              onClick={() => {
                setChosen(null);
                setQuery('');
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              className="input"
              autoComplete="off"
              placeholder="Start typing a name or email address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ fontSize: 13 }}
            />

            {matches.length > 0 && (
              <div
                style={{
                  marginTop: 6,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  background: 'var(--bg-card)',
                }}
              >
                {matches.map((c, i) => {
                  const status = statusOf(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setChosen(c)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: 0,
                        borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                        background: 'transparent',
                        font: 'inherit',
                        fontFamily: 'inherit',
                        color: 'var(--text)',
                        cursor: 'pointer',
                      }}
                    >
                      <Avatar name={c.name} avatarUrl={c.avatarUrl} size={26} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block' }}>{c.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.email}</span>
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: status.tone, whiteSpace: 'nowrap' }}>
                        {status.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
              {searching
                ? 'Looking…'
                : query.trim().length >= 2 && matches.length === 0
                ? emailLooksReal
                  ? 'No account with that address. They will be emailed a private link to read and reply.'
                  : 'Nobody matches that. Type a full email address to write to somebody without an account.'
                : 'Accounts that have confirmed their email. Type a full address for anybody else.'}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            About
          </label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ fontSize: 13 }}>
            {(categories || []).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Only an administrator can hand it to somebody else, the same rule as
            transferring one that already exists. */}
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            Answered by
          </label>
          {isAdmin && staff?.length > 0 ? (
            <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} style={{ fontSize: 13 }}>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.id === currentUserId ? ' (you)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" disabled readOnly value="You" style={{ fontSize: 13 }} />
          )}
        </div>
      </div>

      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Subject
        </label>
        <input
          className="input"
          maxLength={MAX_SUBJECT}
          placeholder="What this is about"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={() => setSubject(sentenceCase(subject))}
          style={{ fontSize: 13 }}
        />
        {subjectProblem && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{subjectProblem}</div>}
      </div>

      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Your message
        </label>
        <textarea
          className="input"
          rows={5}
          maxLength={MAX_MESSAGE}
          placeholder="They see this exactly as written, and it is emailed to them."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onBlur={() => setMessage(sentenceCase(message))}
          style={{ resize: 'vertical', fontSize: 13.5, lineHeight: 1.6 }}
        />
        {/* Only once something has been typed. Telling somebody an empty box is
            too short is not help. */}
        {bodyProblem && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{bodyProblem}</div>}
      </div>

      <AttachmentPicker files={files} setFiles={setFiles} disabled={busy} />

      {progress !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 999,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {progress}%
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!canSend} onClick={send}>
          {busy && <span className="spinner" />}
          Send it
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          It opens waiting on their reply, and at least {MIN_MESSAGE} characters — the same as any other ticket.
        </span>
      </div>
    </div>
  );
}
