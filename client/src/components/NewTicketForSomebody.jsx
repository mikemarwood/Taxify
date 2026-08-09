import { useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { sentenceCase } from '../lib/text.js';

// Raising a ticket for somebody else.
//
// Every conversation started on the customer's side, which assumes every
// conversation does. They do not: somebody rings up, writes to a personal
// address, or an administrator spots a problem on an account before the person
// has noticed. All of that was handled outside the system and summarised into
// it later, if at all — so what was actually said lived in somebody's memory.
//
// Deliberately small. Who it is for, what it is about, and what you want to
// say. Everything else — priority, attachments, who holds it — is already on
// the ticket once it exists, and asking for it twice is how a form nobody uses
// gets built.
export default function NewTicketForSomebody({ categories, onCreated, onCancel }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('other');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const emailLooksReal = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSend = emailLooksReal && subject.trim().length >= 3 && message.trim().length >= 3 && !busy;

  async function send() {
    setBusy(true);
    try {
      const { data } = await api.post('/admin/support/tickets', {
        email: email.trim().toLowerCase(),
        subject: subject.trim(),
        category,
        message: message.trim(),
      });
      toast(
        data.isGuest
          ? `Raised as ${data.reference} — they have no account, so they were emailed a private link`
          : `Raised as ${data.reference} — they have been emailed`,
        'success'
      );
      onCreated?.(data.id);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 180px', gap: 10 }}>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            Who it is for
          </label>
          <input
            className="input"
            type="email"
            autoComplete="off"
            placeholder="their@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ fontSize: 13 }}
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            {/* An address with no account still works. Somebody who rang up
                before signing up is exactly who most needs writing to. */}
            If they have an account it opens in their app. If not, they are emailed a private link to read and reply.
          </div>
        </div>
        <div>
          <label className="label" style={{ fontSize: 11.5 }}>
            About
          </label>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ fontSize: 13 }}
          >
            {(categories || []).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Subject
        </label>
        <input
          className="input"
          maxLength={200}
          placeholder="What this is about"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={() => setSubject(sentenceCase(subject))}
          style={{ fontSize: 13 }}
        />
      </div>

      <div>
        <label className="label" style={{ fontSize: 11.5 }}>
          Your message
        </label>
        <textarea
          className="input"
          rows={5}
          maxLength={5000}
          placeholder="They see this exactly as written, and it is emailed to them."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onBlur={() => setMessage(sentenceCase(message))}
          style={{ resize: 'vertical', fontSize: 13.5, lineHeight: 1.6 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!canSend} onClick={send}>
          {busy && <span className="spinner" />}
          Send it
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {/* Said before it happens, because both are decisions being made on
              their behalf. */}
          It opens assigned to you, waiting on their reply.
        </span>
      </div>
    </div>
  );
}
