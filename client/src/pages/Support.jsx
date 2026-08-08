import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';
import SupportThread, { StatusPill } from '../components/SupportThread.jsx';
import { formatDateTime } from '../lib/dates.js';
import { titleCase, titleCaseLive, sentenceCase, sentenceCaseLive } from '../lib/textCase.js';

// Raising a ticket, listing the ones you have, and reading one. Reachable
// signed in or not — the whole point is that somebody locked out can still get
// hold of us, and that path is the one most likely to be needed.

function CategoryCards({ categories, value, onChange }) {
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
      {categories.map((c) => {
        const on = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            style={{
              textAlign: 'left',
              padding: '11px 13px',
              borderRadius: 10,
              cursor: 'pointer',
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              background: on ? 'var(--accent-soft)' : 'var(--bg-card)',
              // A rail rather than a fill, so the chosen one reads as chosen
              // without the grid turning into a block of colour.
              borderLeft: `3px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{c.label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{c.hint}</div>
          </button>
        );
      })}
    </div>
  );
}

// Trailing blank space only: spaces at the end of any line, and empty lines at
// the end of the message. Everything inside it is left alone, because the blank
// line between two paragraphs is something somebody typed on purpose.
function trimTrailing(text) {
  return String(text ?? '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '');
}

// Long enough to describe a real problem, short enough that the subject stays
// a subject. The message ceiling matches the server's, so nothing is accepted
// here and refused there.
const SUBJECT_MIN = 6;
const SUBJECT_MAX = 120;
const MESSAGE_MIN = 20;
const MESSAGE_MAX = 5000;

// A live count that only speaks up when it matters. A counter ticking from the
// first keystroke reads as a limit being enforced on somebody rather than a
// guide.
function Counter({ value, min, max }) {
  const length = value.trim().length;
  const short = length > 0 && length < min;
  const near = length > max - 100;
  if (!short && !near) return <div style={{ minHeight: 15, marginTop: 4 }} />;
  return (
    <div style={{ fontSize: 11.5, minHeight: 15, marginTop: 4, color: short ? 'var(--red)' : 'var(--text-muted)' }}>
      {short ? `A little more detail please — at least ${min} characters` : `${max - length} characters left`}
    </div>
  );
}

function NewTicket({ user, onRaised }) {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  useEffect(() => {
    api
      .get('/support/categories')
      .then((res) => setCategories(res.data.categories))
      .catch(() => setCategories([]));
  }, []);

  const guest = !user;

  useEffect(() => {
    if (!guest) return;
    api
      .get('/support/captcha')
      .then((res) => setCaptcha(res.data))
      .catch(() => setCaptcha(null));
  }, [guest]);

  const emailLooksReal = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSubmit =
    category &&
    subject.trim().length >= SUBJECT_MIN &&
    subject.trim().length <= SUBJECT_MAX &&
    message.trim().length >= MESSAGE_MIN &&
    message.trim().length <= MESSAGE_MAX &&
    (!guest || (name.trim().length >= 2 && emailLooksReal && captchaAnswer.trim())) &&
    !busy;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const fields = {
        category,
        subject: subject.trim(),
        message: message.trim(),
        ...(guest
          ? {
              name: name.trim(),
              email: email.trim(),
              captchaToken: captcha?.token,
              captchaAnswer: captchaAnswer.trim(),
            }
          : {}),
      };

      let payload = fields;
      if (files.length > 0) {
        payload = new FormData();
        for (const [key, value] of Object.entries(fields)) payload.append(key, value ?? '');
        for (const file of files) payload.append('attachments', file);
      }

      const res = await api.post('/support/tickets', payload);
      onRaised(res.data);
    } catch (err) {
      toast(err.message, 'error');
      if (guest) {
        api
          .get('/support/captcha')
          .then((res) => {
            setCaptcha(res.data);
            setCaptchaAnswer('');
          })
          .catch(() => {});
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>What can we help with?</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Choose the closest match. It decides who picks this up, so it is worth a moment.
        </div>
      </div>

      <CategoryCards categories={categories} value={category} onChange={setCategory} />

      {guest && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <label className="label">Full name</label>
            <input
              className="input"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(titleCaseLive(e.target.value))}
              onBlur={() => setName(titleCase(name))}
            />
          </div>
          <div>
            <label className="label">Email address</label>
            <input
              className="input"
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
              Your reference and a link to this conversation are sent here.
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="label">Subject</label>
        <input
          className="input"
          required
          maxLength={SUBJECT_MAX}
          placeholder="A short summary — for example, receipts will not upload"
          value={subject}
          onChange={(e) => setSubject(sentenceCaseLive(e.target.value))}
          onBlur={() => setSubject(sentenceCase(subject))}
        />
        <Counter value={subject} min={SUBJECT_MIN} max={SUBJECT_MAX} />
      </div>

      <div>
        <label className="label">Tell us what happened</label>
        <textarea
          className="input"
          required
          rows={7}
          maxLength={MESSAGE_MAX}
          placeholder="What you were doing, what you expected to happen, and what happened instead. Anything you have already tried is useful too."
          value={message}
          onChange={(e) => setMessage(sentenceCaseLive(e.target.value))}
          // No sentenceCase on blur here, unlike the subject. It collapses runs
          // of whitespace, and in a message box that means the blank line
          // between two paragraphs is destroyed the moment somebody clicks
          // away. The live pass has already fixed the capitals; the only thing
          // left worth doing is dropping trailing blank space.
          onBlur={() => setMessage(trimTrailing(message))}
          style={{ resize: 'vertical', fontSize: 13.5, lineHeight: 1.6 }}
        />
        <Counter value={message} min={MESSAGE_MIN} max={MESSAGE_MAX} />
      </div>

      {guest && captcha && (
        <div>
          <label className="label">Confirm you are a person</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                fontFamily: 'ui-monospace, monospace',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-subtle)',
                letterSpacing: 1,
              }}
            >
              {captcha.question} =
            </span>
            <input
              className="input"
              required
              inputMode="numeric"
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value.replace(/[^\d-]/g, ''))}
              style={{ width: 92, fontSize: 14 }}
            />
          </div>
        </div>
      )}

      <button className="btn btn-primary" type="submit" disabled={!canSubmit} style={{ alignSelf: 'flex-start' }}>
        {busy && <span className="spinner" />}
        Send request
      </button>
    </form>
  );
}

// What a guest sees once it is raised: their number, and a warning that the
// link lives in their inbox now.
function GuestRaised({ result }) {
  return (
    <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="check-circle" size={22} style={{ color: 'var(--emerald)' }} />
        <div style={{ fontWeight: 800, fontSize: 18 }}>Your request has been received</div>
      </div>
      {/* The reference given its own block. It is the one thing on this screen
          worth writing down, and a number set in running text is a number
          somebody scrolls past. */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 16px',
          background: 'var(--bg-subtle)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 5,
          }}
        >
          Your reference
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 21, fontWeight: 800, letterSpacing: 1 }}>
          {result.ticket.reference}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
        We have emailed you <strong style={{ color: 'var(--text)' }}>a link to this conversation</strong>. Please keep
        it — without an account it is the only way back to this request. We will email you again as soon as somebody has
        replied.
      </div>
      {result.accessToken && (
        <Link
          className="btn btn-primary"
          to={`/support/ticket/${result.accessToken}`}
          style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
        >
          Open it now
        </Link>
      )}
    </div>
  );
}


// A reply, as form data when there are images and JSON when there are not.
// Sending multipart unconditionally would work, but it turns every ordinary
// reply into a file upload for no reason.
function replyBody(message, files) {
  if (!files || files.length === 0) return { message };
  const form = new FormData();
  form.append('message', message);
  for (const file of files) form.append('attachments', file);
  return form;
}

function TicketRow({ ticket, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card"
      style={{
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        width: '100%',
        borderLeft: `3px solid ${ticket.status === 'awaiting_customer' ? 'var(--amber)' : 'var(--border)'}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 180 }}>
        {/* The reference sits above the subject, small and set apart. It is
            what somebody quotes back to us, so it should be findable at a
            glance rather than buried in a line of dot-separated detail. */}
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            color: 'var(--text-muted)',
            marginBottom: 3,
          }}
        >
          {ticket.reference}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{ticket.subject}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
          {ticket.categoryLabel} · updated {formatDateTime(ticket.lastMessageAt || ticket.createdAt)}
        </div>
      </div>
      <StatusPill status={ticket.status} />
    </button>
  );
}

export default function Support() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState(null);
  const [raised, setRaised] = useState(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (!user) {
      setTickets([]);
      return;
    }
    api
      .get('/support/tickets')
      .then((res) => setTickets(res.data.tickets))
      .catch(() => setTickets([]));
  }, [user]);

  function onRaised(result) {
    if (!user) {
      setRaised(result);
      return;
    }
    toast(`Raised as ${result.ticket.reference}`, 'success');
    navigate(`/support/${result.ticket.id}`);
  }

  if (raised) return <GuestRaised result={raised} />;

  const showForm = writing || !user || (tickets && tickets.length === 0);

  return (
    <div style={{ maxWidth: 840, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ margin: '0 0 6px', fontSize: 26 }}>Support</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.6, maxWidth: 560 }}>
          Send us a message and we will look into it. Every request gets a reference number, a written reply, and stays
          on record so you can come back to it.
        </p>
      </div>

      {user && tickets && tickets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Your requests</div>
            <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setWriting((v) => !v)}>
              {writing ? 'Cancel' : 'New request'}
            </button>
          </div>
          {tickets.map((t) => (
            <TicketRow key={t.id} ticket={t} onOpen={() => navigate(`/support/${t.id}`)} />
          ))}
        </div>
      )}

      {showForm && <NewTicket user={user} onRaised={onRaised} />}
    </div>
  );
}

// One ticket, for the account that owns it.
export function SupportTicket() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);

  function load() {
    api
      .get(`/support/tickets/${id}`)
      .then((res) => setData(res.data))
      .catch((err) => toast(err.message, 'error'));
  }

  useEffect(load, [id]);

  if (!data) return <div className="card" style={{ padding: 20, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TicketHeading ticket={data.ticket} />
      <SupportThread
        ticket={data.ticket}
        messages={data.messages}
        onRefresh={load}
        onReply={async (message, files) => {
          const res = await api.post(`/support/tickets/${id}/reply`, replyBody(message, files));
          setData((prev) => ({ ...prev, ticket: { ...prev.ticket, status: res.data.status }, messages: res.data.messages }));
        }}
      />
    </div>
  );
}

// A guest reading through the link they were emailed.
export function SupportTicketByToken() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState('');

  function load() {
    api
      .get(`/support/ticket-by-token?token=${encodeURIComponent(token)}`)
      .then((res) => setData(res.data))
      .catch(() => setProblem('That link does not open anything. Check you used the most recent email.'));
  }

  useEffect(load, [token]);

  if (problem) {
    return (
      <div className="card" style={{ padding: 24, maxWidth: 560, margin: '40px auto', fontSize: 13.5 }}>
        {problem}
      </div>
    );
  }
  if (!data) return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 780, margin: '32px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TicketHeading ticket={data.ticket} />
      <SupportThread
        ticket={data.ticket}
        messages={data.messages}
        onRefresh={load}
        onReply={async (message, files) => {
          const body = replyBody(message, files);
          if (body instanceof FormData) body.append('token', token);
          else body.token = token;
          const res = await api.post('/support/reply-by-token', body);
          setData((prev) => ({ ...prev, ticket: { ...prev.ticket, status: res.data.status }, messages: res.data.messages }));
        }}
      />
    </div>
  );
}

function TicketHeading({ ticket }) {
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: 0.5,
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}
          >
            {ticket.reference}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3 }}>{ticket.subject}</div>
        </div>
        <StatusPill status={ticket.status} />
      </div>

      {/* The facts as a row of labelled pairs rather than a run-on line, so
          each can be found without reading the others. */}
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        {[
          ['Category', ticket.categoryLabel],
          ['Raised', formatDateTime(ticket.createdAt)],
          ...(ticket.lastMessageAt ? [['Last update', formatDateTime(ticket.lastMessageAt)]] : []),
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {label}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
