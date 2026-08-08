import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { formatDateTime } from '../lib/dates.js';
import { sentenceCaseLive } from '../lib/textCase.js';
import { useToast } from './Toast.jsx';
import ImageLightbox from './ImageLightbox.jsx';

// Matched to the server. Stated here as well so somebody is told before a
// 8 MB upload crawls up a phone connection only to be refused at the far end.
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];

function readableSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
import { playInfo } from '../lib/sounds.js';

// How often an open conversation checks for a reply. Slow enough to be no load
// at all, fast enough that somebody watching the page sees an answer arrive
// without reaching for refresh.
const POLL_MS = 8000;

export function StatusPill({ status, admin = false }) {
  const map = admin
    ? {
        awaiting_support: { label: 'Awaiting reply', colour: 'var(--accent)' },
        awaiting_customer: { label: 'With customer', colour: 'var(--accent)' },
        closed: { label: 'Closed', colour: 'var(--text-muted)' },
      }
    : {
        awaiting_support: { label: 'In progress', colour: 'var(--accent)' },
        awaiting_customer: { label: 'Awaiting your reply', colour: 'var(--accent)' },
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
  const note = role === 'note';
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
        color: note ? 'var(--note-ink)' : support ? '#fff' : 'var(--text-muted)',
        background: note ? 'var(--note-soft)' : support ? 'var(--accent)' : 'var(--bg-subtle)',
        border: `1px solid ${note ? 'var(--note)' : support ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      {note ? 'Internal note' : support ? 'Support' : 'Customer'}
    </span>
  );
}

export const MIN_MESSAGE = 20;
export const MAX_MESSAGE = 5000;

// What is wrong with this text, or '' if nothing is. Mirrors messageProblem on
// the server so the same words come back either way.
export function messageProblem(body, { note = false } = {}) {
  const text = String(body ?? '').trim();
  if (!text) return 'Write a message first';
  if (!note && text.length < MIN_MESSAGE) return `Tell us a little more — at least ${MIN_MESSAGE} characters`;
  if (text.length > MAX_MESSAGE) return `Messages can be at most ${MAX_MESSAGE} characters`;
  return '';
}

function Message({ message, canEdit, canDelete, onDelete, onEdit, onPreview }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmed = draft.trim();
  const changed = trimmed !== message.body.trim();
  const problem = messageProblem(draft, { note: message.role === 'note' });

  async function save() {
    const next = trimmed;
    if (!changed || problem) return setEditing(false);
    setSaving(true);
    try {
      await onEdit(message, next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

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
  // An internal note has to be unmistakable. Somebody skim-reading a thread and
  // taking a note for something the customer was told is the failure this
  // guards against, so it gets its own colour, its own badge and its own words.
  const note = message.role === 'note';
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
            background: note ? 'var(--note-soft)' : support ? 'var(--accent-soft)' : 'var(--bg-card)',
            borderLeft: `3px solid ${note ? 'var(--note)' : support ? 'var(--accent)' : 'var(--border)'}`,
          }}
        >
          {message.body}
        </div>

        {(canEdit || message.editedAt) && !editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(true);
                }}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--accent)',
                }}
              >
                Edit
              </button>
            )}

            {/* Only ever a note, and only your own. A reply has been emailed to
                the customer and read by them, so removing it from the thread
                would leave the two sides of the same conversation disagreeing
                about what was said. A note has been read by nobody outside the
                team, so whoever wrote it may think better of it. */}
            {canDelete && (
              <button
                type="button"
                onClick={() => onDelete(message)}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--red)',
                }}
              >
                Delete note
              </button>
            )}

            {/* Said plainly, and openable. "Edited" on its own asks the reader
                to take on trust that nothing important changed — in a record of
                what was agreed, that is exactly the wrong thing to ask. */}
            {message.editedAt && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11.5,
                  color: 'var(--text-muted)',
                  textDecoration: 'underline',
                }}
              >
                Edited {formatDateTime(message.editedAt)} · {showHistory ? 'hide' : 'see'} what changed
              </button>
            )}
          </div>
        )}

        {showHistory && message.history?.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {message.history.map((old, index) => (
              <div
                key={`${old.at}-${index}`}
                style={{
                  border: '1px solid var(--border)',
                  borderLeft: '3px solid var(--text-muted)',
                  borderRadius: 8,
                  padding: '9px 11px',
                  background: 'var(--bg-subtle)',
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Before {formatDateTime(old.at)}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>
                  {old.body}
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              className="input"
              rows={4}
              maxLength={MAX_MESSAGE}
              value={draft}
              onChange={(e) => setDraft(sentenceCaseLive(e.target.value))}
              style={{ resize: 'vertical', fontSize: 13.5, lineHeight: 1.6 }}
            />

            {/* Said while there is still something to do about it, and only
                once they have actually changed something — telling somebody
                their untouched message is too short is not help. */}
            {changed && problem && (
              <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{problem}</span>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: 12.5 }}
                disabled={saving || !changed || Boolean(problem)}
                onClick={save}
              >
                {saving && <span className="spinner" />}
                Save
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12.5 }} disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                The original is kept and shown alongside.
              </span>
            </div>
          </div>
        )}

        {message.attachments?.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {message.attachments.map((a) => (
              <button
                key={a.url}
                type="button"
                onClick={() => onPreview?.(a)}
                title={`${a.name} · ${readableSize(a.bytes)}`}
                style={{
                  display: 'block',
                  padding: 0,
                  cursor: 'zoom-in',
                  width: 108,
                  height: 108,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-subtle)',
                }}
              >
                {/* The thumbnail is the file itself rather than a generated
                    one — these are screenshots, a handful per ticket at most,
                    and a resizing pipeline for that is machinery nobody needs. */}
                <img
                  src={a.url}
                  alt={a.name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
          </div>
        )}
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
  onEdit,
  // Removing an internal note. Support side only; undefined everywhere else,
  // which reads as "not offered".
  onDelete,
  currentUserId = null,
  onRefresh,
  busy,
  admin = false,
  onReopen,
  // On the support side, whether this ticket is yours to answer. Undefined
  // everywhere else, which reads as yes — a customer is always allowed to
  // reply to their own conversation.
  canReply: mayReply = true,
  extraActions = null,
}) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  // null when nothing is uploading. A number is a percentage.
  const [progress, setProgress] = useState(null);
  // Which attachment is being looked at, or null. Held here rather than in the
  // message so opening one closes any other.
  const [preview, setPreview] = useState(null);

  const closed = ticket?.status === 'closed';
  const locked = closed || !mayReply;
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


  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      // The third argument is how far along the upload is. Passed down rather
      // than measured here, because only the caller knows which request is
      // actually carrying the bytes.
      await onReply(text, files, files.length > 0 ? setProgress : null);
      setDraft('');
      setFiles([]);
    } catch (err) {
      // Nothing caught this before, so a reply that failed looked exactly like
      // a reply that did nothing: the text stayed in the box, no message
      // appeared, and there was no way to tell which had happened. The draft is
      // kept on purpose — losing what somebody just wrote is worse than the
      // failure that lost it.
      toast(err?.message || 'That did not send. Please try again.', 'error');
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AnimatePresence initial={false}>
          {(messages || []).map((m) => (
            <Message
              key={m.id}
              message={m}
              onPreview={setPreview}
              // Your own words, and only while the conversation is open. A
              // closed ticket is a finished record.
              // Your own words, and — for a note — your own note. A note was
              // excluded by this test, so whoever wrote one could not correct
              // a typo in it.
              canEdit={
                Boolean(onEdit) &&
                !closed &&
                (m.role === (admin ? 'support' : 'customer') || (m.role === 'note' && m.authorId === currentUserId))
              }
              canDelete={Boolean(onDelete) && !closed && m.role === 'note' && m.authorId === currentUserId}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </AnimatePresence>

        <ImageLightbox
          open={Boolean(preview)}
          src={preview?.url || ''}
          name={preview?.name || ''}
          onClose={() => setPreview(null)}
        />
      </div>

      {extraActions}

      {locked ? (
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
          {!closed && admin
            ? 'Take this ticket to reply to it.'
            : admin
            ? 'This request is closed. Reopen it to reply.'
            : 'This request has been closed.'}

          {/* The notice used to say "let us know and we will reopen it" with no
              way to do either. Saying that and offering nothing is worse than
              saying nothing. */}
          {!admin && closed && onReopen && (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12.5, marginLeft: 'auto' }}
              disabled={busy}
              onClick={async () => {
                try {
                  await onReopen();
                } catch (err) {
                  toast(err?.message || 'That did not work — please try again', 'error');
                }
              }}
            >
              Ask us to look again
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            // Sticky rather than fixed: it belongs to the conversation, so it
            // should stop at the end of it rather than float over whatever
            // comes after. Sticky needs no ancestor to have an overflow rule —
            // checked, and none does — or it silently stops working.
            position: 'sticky',
            bottom: 0,
            zIndex: 3,
            // Its own ground, or the messages show through it as they pass
            // underneath. The negative margin and matching padding let that
            // ground reach the edges of the card it sits in.
            background: 'var(--bg-card)',
            margin: '0 -4px -4px',
            padding: '10px 4px 4px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <textarea
            className="input"
            rows={4}
            maxLength={MAX_MESSAGE}
            placeholder={admin ? 'Write your reply…' : 'Add anything else that might help…'}
            value={draft}
            // Capitals fixed as you type. Safe per keystroke because it only
            // changes the case of characters already there — the length never
            // moves, so neither does the caret, and whitespace is untouched so
            // paragraphs can still be written.
            onChange={(e) => setDraft(sentenceCaseLive(e.target.value))}
            style={{ resize: 'vertical', fontSize: 13.5, lineHeight: 1.6 }}
          />
          <AttachmentPicker files={files} setFiles={setFiles} disabled={sending || busy} />

          {/* Shown only while bytes are actually moving. A bar for a text-only
              reply would be measuring nothing, and one left sitting at 100%
              afterwards is worse than none — so it goes the moment the request
              finishes, whether it worked or not. */}
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
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    transition: 'width 0.2s ease-out',
                  }}
                />
              </div>
              <span
                style={{ fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 82 }}
              >
                {progress < 100 ? `Uploading ${progress}%` : 'Finishing…'}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              disabled={Boolean(messageProblem(draft)) || sending || busy}
              onClick={send}
            >
              {sending && <span className="spinner" />}
              Send reply
            </button>

            <span style={{ fontSize: 11.5, color: draft.trim() && messageProblem(draft) ? 'var(--red)' : 'var(--text-muted)' }}>
              {draft.trim() && messageProblem(draft)
                ? messageProblem(draft)
                : admin
                ? 'They are emailed as soon as you send this.'
                : 'We will email you as soon as we reply.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// The attachment picker, shared.
//
// The reply box grew one first, and the form that raises a ticket was left
// without — so somebody could attach a screenshot to a follow-up but not to the
// message where they were describing the problem, which is the one that needs
// it. Exported rather than copied, so the limits, the wording and the checks
// cannot drift into two versions of themselves.
export function AttachmentPicker({ files, setFiles, disabled = false }) {
  const toast = useToast();

  function addFiles(chosen) {
    const picked = Array.from(chosen || []);
    const kept = [];

    for (const file of picked) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast(`${file.name} is not an image — JPG, PNG, WEBP, HEIC and GIF only`, 'error');
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast(`${file.name} is ${readableSize(file.size)} — the limit is ${readableSize(MAX_ATTACHMENT_BYTES)}`, 'error');
        continue;
      }
      kept.push(file);
    }

    setFiles((prev) => {
      const room = MAX_ATTACHMENTS - prev.length;
      if (kept.length > room) toast(`You can attach ${MAX_ATTACHMENTS} images at most`, 'error');
      return [...prev, ...kept.slice(0, Math.max(0, room))];
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 8px 5px 5px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-subtle)',
                fontSize: 12,
              }}
            >
              <img
                src={URL.createObjectURL(file)}
                alt=""
                style={{ width: 30, height: 30, borderRadius: 5, objectFit: 'cover', display: 'block' }}
              />
              <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{readableSize(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <label
        className="btn btn-ghost"
        style={{
          fontSize: 12.5,
          gap: 6,
          alignSelf: 'flex-start',
          cursor: disabled || files.length >= MAX_ATTACHMENTS ? 'not-allowed' : 'pointer',
        }}
        title={`Up to ${MAX_ATTACHMENTS} images, ${readableSize(MAX_ATTACHMENT_BYTES)} each`}
      >
        <Icon name="image" size={14} />
        Attach image
        <input
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          multiple
          disabled={disabled || files.length >= MAX_ATTACHMENTS}
          onChange={(e) => {
            addFiles(e.target.files);
            // Cleared so choosing the same file twice in a row still fires.
            e.target.value = '';
          }}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  );
}
