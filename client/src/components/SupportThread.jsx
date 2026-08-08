import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { formatDateTime } from '../lib/dates.js';
import { sentenceCaseLive } from '../lib/textCase.js';
import { playInfo } from '../lib/sounds.js';

// How often an open conversation checks for a reply. Slow enough to be no load
// at all, fast enough that somebody watching the page sees an answer arrive
// without reaching for refresh.
const POLL_MS = 8000;

export function StatusPill({ status, admin = false }) {
  const map = admin
    ? {
        awaiting_support: { label: 'Needs a reply', colour: 'var(--amber)' },
        awaiting_customer: { label: 'Waiting on customer', colour: 'var(--accent)' },
        closed: { label: 'Closed', colour: 'var(--text-muted)' },
      }
    : {
        awaiting_support: { label: 'With support', colour: 'var(--accent)' },
        awaiting_customer: { label: 'Waiting for you', colour: 'var(--amber)' },
        closed: { label: 'Closed', colour: 'var(--text-muted)' },
      };
  const s = map[status] || map.awaiting_support;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        padding: '3px 9px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        color: s.colour,
        border: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
      }}
    >
      {s.label}
    </span>
  );
}

// Who is speaking. Support and customer are told apart by more than a colour —
// the badge says which, because on a phone the two sides of a conversation
// otherwise run together.
function RoleBadge({ role }) {
  if (role === 'system') return null;
  const support = role === 'support';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 999,
        color: support ? '#fff' : 'var(--text-muted)',
        background: support ? 'var(--accent)' : 'var(--bg-subtle)',
        border: `1px solid ${support ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      {support ? 'Support' : 'Customer'}
    </span>
  );
}

function Message({ message }) {
  if (message.role === 'system') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {message.body} · {formatDateTime(message.createdAt)}
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
    );
  }

  const support = message.role === 'support';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}
    >
      <Avatar name={message.name} avatarUrl={message.avatarUrl} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{message.name || (support ? 'Support' : 'You')}</span>
          <RoleBadge role={message.role} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDateTime(message.createdAt)}</span>
        </div>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            // People write in paragraphs. Collapsing them turns a considered
            // message into a wall.
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: '11px 13px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: support ? 'var(--accent-soft)' : 'var(--bg-card)',
            borderLeft: `3px solid ${support ? 'var(--accent)' : 'var(--border)'}`,
          }}
        >
          {message.body}
        </div>
      </div>
    </motion.div>
  );
}

// The conversation itself, used by all three places one is read: a customer's
// ticket, a guest's link, and the admin panel. One component, so a reply looks
// the same wherever it is written.
export default function SupportThread({
  ticket,
  messages,
  onReply,
  onRefresh,
  busy,
  admin = false,
  extraActions = null,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // What we last saw, so a reply arriving while the page is open can announce
  // itself rather than appearing silently.
  const seen = useRef(messages?.length || 0);

  useEffect(() => {
    if (!onRefresh) return undefined;
    const timer = setInterval(onRefresh, POLL_MS);
    return () => clearInterval(timer);
  }, [onRefresh]);

  useEffect(() => {
    const count = messages?.length || 0;
    // Only for messages that arrive after the page has settled — not for the
    // first load, which would chime every time somebody opened a ticket.
    if (count > seen.current && seen.current > 0) playInfo();
    seen.current = count;
  }, [messages]);

  const closed = ticket?.status === 'closed';

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await onReply(text);
      setDraft('');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AnimatePresence initial={false}>
          {(messages || []).map((m) => (
            <Message key={m.id} message={m} />
          ))}
        </AnimatePresence>
      </div>

      {extraActions}

      {closed ? (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            fontSize: 12.5,
            color: 'var(--text-muted)',
            background: 'var(--bg-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
          }}
        >
          <Icon name="lock" size={14} />
          {admin
            ? 'This ticket is closed. Open it again to reply.'
            : 'This ticket is closed. If it was not sorted, ask us to open it again.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            className="input"
            rows={4}
            maxLength={5000}
            placeholder={admin ? 'Write your reply…' : 'Add to the conversation…'}
            value={draft}
            // Capitals fixed as you type. Safe per keystroke because it only
            // changes the case of characters already there — the length never
            // moves, so neither does the caret, and whitespace is untouched so
            // paragraphs can still be written.
            onChange={(e) => setDraft(sentenceCaseLive(e.target.value))}
            style={{ resize: 'vertical', fontSize: 13.5, lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              disabled={!draft.trim() || sending || busy}
              onClick={send}
            >
              {sending && <span className="spinner" />}
              Send reply
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {admin ? 'They will be emailed straight away.' : 'We will email you when there is a reply.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
