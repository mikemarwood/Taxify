import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from './../lib/ConfirmContext.jsx';
import { sentenceCaseLive } from '../lib/textCase.js';
import SupportThread, { StatusPill } from './SupportThread.jsx';
import { formatDateTime } from '../lib/dates.js';
import { playInfo } from '../lib/sounds.js';
import { useAuth } from '../lib/AuthContext.jsx';

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', colour: 'var(--red)' },
  { value: 'high', label: 'High', colour: 'var(--amber)' },
  { value: 'normal', label: 'Normal', colour: 'var(--text-muted)' },
  { value: 'low', label: 'Low', colour: 'var(--text-muted)' },
];

// Hours a ticket may sit with us before it is worth flagging. Mirrors the
// server's table — not a promise to anybody, just a way for a ticket assigned
// to somebody on holiday to look neglected instead of merely waiting.
const STALE_HOURS = { urgent: 4, high: 12, normal: 48, low: 120 };

function isStale(ticket) {
  if (ticket.status !== 'awaiting_support') return false;
  const since = new Date(ticket.lastMessageAt || ticket.createdAt || 0).getTime();
  if (!since) return false;
  return Date.now() - since > (STALE_HOURS[ticket.priority] ?? STALE_HOURS.normal) * 3600 * 1000;
}
import PlanRequestPanel from './PlanRequestPanel.jsx';
import NewTicketForSomebody from './NewTicketForSomebody.jsx';

// How often the queue re-checks. The thread does its own polling while open;
// this is for the list behind it, so a new ticket appears without a refresh.
const POLL_MS = 15000;

function Row({ ticket, active, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        padding: '11px 12px',
        borderRadius: 9,
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent-soft)' : 'var(--bg-card)',
        // Needing a reply is the only state worth flagging in a list — the
        // others are things somebody else is doing.
        borderLeft: `3px solid ${ticket.status === 'awaiting_support' ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      <Avatar name={ticket.who} avatarUrl={ticket.avatarUrl} hue={ticket.hue ?? null} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ticket.subject}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ticket.who || 'Someone'}
          {ticket.isGuest && ' · guest'} · {ticket.categoryLabel}
          {ticket.assignedTo ? ` · ${ticket.assignedName || 'assigned'}` : ' · unassigned'}
          {ticket.priority && ticket.priority !== 'normal' && (
            <span style={{ color: PRIORITIES.find((x) => x.value === ticket.priority)?.colour, fontWeight: 700 }}>
              {' · '}
              {ticket.priority}
            </span>
          )}
          {isStale(ticket) && <span style={{ color: 'var(--red)', fontWeight: 700 }}> · overdue</span>}
        </div>
      </div>
    </button>
  );
}

// An icon per category, so a ticket can be recognised before it is read.
// Falls back to the generic one, which is what a category added later gets
// until somebody picks it a shape.
const CATEGORY_ICONS = {
  account: 'user',
  billing: 'cash',
  technical: 'wrench',
  receipts: 'receipt',
  accountant: 'briefcase',
  feedback: 'heart',
  other: 'mail',
};

function categoryIcon(value) {
  return CATEGORY_ICONS[value] || 'mail';
}

// The shape of the queue, before any of it is read.
//
// The tab showed one filtered page and nothing else, so how much work there was
// could only be found by clicking each filter in turn. These are the numbers
// somebody opens this screen to find out, and the ones that mean "somebody is
// waiting" are the only ones that get a colour.
function Tile({ label, value, tone = 'plain', onClick, active }) {
  const loud = tone === 'loud' && value > 0;
  const good = tone === 'good';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        flex: '1 1 120px',
        minWidth: 108,
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 10,
        font: 'inherit',
        fontFamily: 'inherit',
        cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${active ? 'var(--accent)' : loud ? 'var(--red)' : 'var(--border)'}`,
        background: active ? 'var(--accent-soft)' : 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: 22,
          fontWeight: 800,
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
          color: loud ? 'var(--red)' : good ? 'var(--emerald)' : 'var(--text)',
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
    </button>
  );
}

function since(value) {
  if (!value) return '—';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  return `${Math.floor(days / 365)} years`;
}

// Who is asking, beside what they asked.
//
// Half of answering a question is knowing whether the person writing in is on
// a trial, has just paid, or has written in four times this month. All of that
// meant leaving the ticket, finding them under Users, and coming back — by
// which point the question has been read twice.
function CustomerStrip({ customer, ticket }) {
  const facts = customer
    ? [
        ['Plan', customer.planType === 'business' ? 'Small Business' : 'Individual'],
        ['Status', customer.subscriptionStatus === 'trialing' ? 'On trial' : customer.subscriptionStatus || 'None'],
        ['With us', since(customer.joinedAt)],
        ['Tickets', customer.ticketCount],
        ...(customer.country ? [['Country', customer.country]] : []),
        ...(customer.accountNumber ? [['Account', customer.accountNumber]] : []),
      ]
    : [
        ['Account', 'None — wrote in as a guest'],
        // No email row. It was the guest's address, and the payload no longer
        // carries one — leaving the row would print a permanent dash, which
        // reads as missing data rather than as withheld. It is in the strip
        // above, behind "Show who this is", along with the name.
      ];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0,
        border: '1px solid var(--border)',
        borderRadius: 9,
        overflow: 'hidden',
        background: 'var(--bg-subtle)',
      }}
    >
      {facts.map(([label, value], index) => (
        <div
          key={label}
          style={{
            flex: '1 1 108px',
            minWidth: 96,
            padding: '9px 12px',
            borderLeft: index === 0 ? 'none' : '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
            {label}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export default function SupportTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('open');
  // Which kind of question, or all of them. A filter the server already
  // supported and nothing on screen offered.
  const [category, setCategory] = useState('');
  const [summary, setSummary] = useState(null);
  const [starting, setStarting] = useState(false);
  // The list of categories, from the same route the customer form uses — so
  // a category added later appears on both sides without being typed twice.
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState('');
  const [tickets, setTickets] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [busy, setBusy] = useState(false);
  // How many were waiting last time, so a new one arriving can be heard rather
  // than only seen by somebody already looking at the screen.
  const waiting = useRef(null);

  function loadList() {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (filter === 'mine') params.set('mine', '1');
    if (filter === 'unassigned') params.set('unassigned', '1');
    if (filter === 'closed') params.set('status', 'closed');
    if (filter === 'waiting') params.set('status', 'awaiting_customer');
    if (category) params.set('category', category);
    if (page > 1) params.set('page', String(page));

    api
      .get(`/admin/support/tickets?${params.toString()}`)
      .then((res) => {
        const list = res.data.tickets;
        const needing = list.filter((t) => t.status === 'awaiting_support').length;
        if (waiting.current !== null && needing > waiting.current) playInfo();
        waiting.current = needing;
        setTickets(list);
        setTotal(res.data.total || list.length);
        if (res.data.summary) setSummary(res.data.summary);
      })
      .catch((err) => {
        toast(err.message, 'error');
        setTickets([]);
      });
  }

  // Stable, because SupportThread keys its eight-second poll on the identity
  // of what it was handed. An inline arrow is a new function every render, so
  // the interval was being torn down and rebuilt continuously — it survived
  // only because the list poll happens to be slower than the thread poll, and
  // anything that re-rendered this panel faster would have stopped it firing
  // at all.
  const refreshThread = useCallback(() => {
    if (openId) loadThread(openId);
    // loadThread is redefined each render and deliberately not a dependency:
    // including it would put the churn straight back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  function loadThread(id) {
    api
      .get(`/admin/support/tickets/${id}`)
      .then((res) => setThread(res.data))
      .catch((err) => toast(err.message, 'error'));
  }

  useEffect(() => {
    api
      .get('/admin/support/staff')
      .then((res) => setStaff(res.data.staff))
      .catch(() => setStaff([]));
    api
      .get('/support/categories')
      .then((res) => setCategories(res.data.categories || []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const debounce = setTimeout(loadList, query ? 300 : 0);
    const timer = setInterval(loadList, POLL_MS);
    return () => {
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [query, filter, page, category]);

  useEffect(() => {
    if (openId) loadThread(openId);
    else setThread(null);
  }, [openId]);

  async function remove() {
    const ok = await confirm({
      tone: 'danger',
      title: 'Delete this conversation?',
      body: 'The whole thread and every image attached to it are removed for good. This cannot be undone.',
      // "delete", not the reference — typing a code you can see is copying;
      // typing the word is a decision.
      requireText: 'delete',
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.delete(`/admin/support/tickets/${openId}`);
      setOpenId(null);
      loadList();
      toast('Deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function assign(userId) {
    const to = userId ? staff.find((person) => person.id === userId) : null;
    const held = thread?.ticket?.assignedTo ? thread.ticket.assignedName : null;

    const ok = await confirm({
      title: to ? `Pass this to ${to.name}?` : 'Take this ticket?',
      body: to ? (
        <>
          <div style={{ marginBottom: 8 }}>
            {to.id === user?.id
              ? 'It becomes yours to answer.'
              : `${to.name} becomes the only person who can reply to it, and they will be notified.`}
          </div>
          <div>
            {held
              ? `${held} is dealing with it at the moment and will no longer be able to reply.`
              : 'Nobody is dealing with it at the moment.'}
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            It becomes yours to answer, and nobody else on the team will be able to reply to it.
          </div>
          <div>You can hand it back at any time.</div>
        </>
      ),
      confirmLabel: to ? 'Pass it over' : 'Take it',
      cancelLabel: 'Not now',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.post(`/admin/support/tickets/${openId}/assign`, userId ? { userId } : {});
      loadThread(openId);
      loadList();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    try {
      await api.post(`/admin/support/tickets/${openId}/assign`, { release: true });
      loadThread(openId);
      loadList();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(closing) {
    if (closing) {
      const ok = await confirm({
        title: 'Close this ticket?',
        body: 'Nobody can reply until it is opened again. They are emailed to say it is closed, and how to reopen it.',
        confirmLabel: 'Close ticket',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api.post(`/admin/support/tickets/${openId}/status`, {
        status: closing ? 'closed' : 'awaiting_support',
      });
      setThread((prev) => ({
        ...prev,
        ticket: { ...prev.ticket, status: closing ? 'closed' : 'awaiting_support' },
        messages: res.data.messages,
      }));
      loadList();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!tickets) return <div className="card" style={{ padding: 20, fontSize: 13 }}>Loading…</div>;

  const mine = thread?.ticket?.assignedTo === user?.id;
  const needing = tickets.filter((t) => t.status === 'awaiting_support');
  const others = tickets.filter((t) => t.status !== 'awaiting_support');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* What the queue looks like before any of it is read. The tiles are
          also the filters — a number worth showing is a number worth being
          able to press. */}
      {summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tile
              label="Needs a reply"
              value={summary.awaitingSupport}
              tone="loud"
              active={filter === 'open' && !category}
              onClick={() => {
                setPage(1);
                setCategory('');
                setFilter('open');
              }}
            />
            <Tile
              label="Waiting on them"
              value={summary.awaitingCustomer}
              active={filter === 'waiting'}
              onClick={() => {
                setPage(1);
                setFilter('waiting');
              }}
            />
            <Tile
              label="Nobody has it"
              value={summary.unassigned}
              tone="loud"
              active={filter === 'unassigned'}
              onClick={() => {
                setPage(1);
                setFilter('unassigned');
              }}
            />
            <Tile
              label="Yours"
              value={summary.mine}
              active={filter === 'mine'}
              onClick={() => {
                setPage(1);
                setFilter('mine');
              }}
            />
            <Tile label="Closed this week" value={summary.closedThisWeek} tone="good" />
          </div>

          {/* Not everything starts on their side. Somebody rings up, or an
              account has a problem before the person has noticed it. */}
          {!starting && (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12.5, alignSelf: 'flex-start', gap: 6 }}
              onClick={() => setStarting(true)}
            >
              <Icon name="plus" size={13} />
              Create ticket on behalf of customer
            </button>
          )}

          {/* What people are actually writing in about. The server already
              filtered by category and nothing on screen offered it, so the
              answer to "is this a billing week or a receipts week" needed a
              database. Only categories with something open are shown — a chip
              reading zero is a filter for an empty list. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
              About
            </span>
            <button
              type="button"
              className={category === '' ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ fontSize: 11.5, padding: '4px 10px' }}
              onClick={() => {
                setPage(1);
                setCategory('');
              }}
            >
              Everything
            </button>
            {categories.filter((c) => (summary.categories?.[c.value] || 0) > 0).map((c) => (
              <button
                key={c.value}
                type="button"
                className={category === c.value ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ fontSize: 11.5, padding: '4px 10px', gap: 6 }}
                onClick={() => {
                  setPage(1);
                  setCategory(category === c.value ? '' : c.value);
                }}
              >
                <Icon name={categoryIcon(c.value)} size={12} />
                {c.label}
                <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', opacity: 0.75 }}>
                  {summary.categories[c.value]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {starting && (
        <NewTicketForSomebody
          categories={categories}
          staff={staff}
          currentUserId={user?.id ?? null}
          isAdmin={Boolean(user?.isAdmin)}
          onCancel={() => setStarting(false)}
          onCreated={(id) => {
            setStarting(false);
            setFilter('mine');
            setPage(1);
            setOpenId(id);
            loadList();
          }}
        />
      )}

    {/* data-reading is what the stylesheet uses to get the list out of the
        way on a phone once a ticket is open. On a wide screen both stay. */}
    <div className="support-layout" data-reading={openId ? 'true' : 'false'}>
      <div className="support-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          className="input"
          placeholder="Search reference, subject or person…"
          value={query}
          onChange={(e) => {
            setPage(1);
            // Capitalised as it is typed. Safe per keystroke because it only
            // changes the case of characters already there — the length never
            // moves, so neither does the caret.
            setQuery(sentenceCaseLive(e.target.value));
          }}
          style={{ fontSize: 12.5 }}
        />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            ['open', 'All open'],
            ['mine', 'Mine'],
            ['unassigned', 'Unassigned'],
            ['closed', 'Closed'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ fontSize: 11.5, padding: '4px 9px' }}
              onClick={() => {
                setPage(1);
                setFilter(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Needs a reply</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 999,
              color: needing.length ? '#fff' : 'var(--text-muted)',
              background: needing.length ? 'var(--accent)' : 'var(--bg-subtle)',
              border: '1px solid var(--border)',
            }}
          >
            {needing.length}
          </span>
        </div>

        {needing.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing waiting. </div>
        )}
        {needing.map((t) => (
          <Row key={t.id} ticket={t} active={openId === t.id} onOpen={() => setOpenId(t.id)} />
        ))}

        {total > tickets.length && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11.5, padding: '4px 9px' }}
              disabled={page <= 1}
              onClick={() => setPage((v) => Math.max(1, v - 1))}
            >
              Back
            </button>
            <span>
              {tickets.length} of {total}
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11.5, padding: '4px 9px' }}
              disabled={page * 40 >= total}
              onClick={() => setPage((v) => v + 1)}
            >
              More
            </button>
          </div>
        )}

        {others.length > 0 && (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>Everything else</div>
            {others.map((t) => (
              <Row key={t.id} ticket={t} active={openId === t.id} onOpen={() => setOpenId(t.id)} />
            ))}
          </>
        )}
      </div>

      <div>
        {!thread ? (
          <div className="card" style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>
            Choose a ticket to read it.
          </div>
        ) : (
          <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              className="support-sticky-top"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                flexWrap: 'wrap',
                background: 'var(--bg-card)',
                margin: '-18px -18px 0',
                padding: '18px 18px 12px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {/* The category as a mark rather than a word buried in a line
                  of dot-separated text. Somebody scanning a screen full of
                  tickets recognises the shape before they read anything. */}
              {/* The way out on a phone, where the list is hidden while a
                  ticket is open. Shown by the stylesheet at the same width
                  that hides the list, so the two can never disagree. */}
              <button
                type="button"
                className="btn btn-ghost support-back"
                style={{ fontSize: 12.5, gap: 6, alignItems: 'center', flexShrink: 0 }}
                onClick={() => setOpenId(null)}
              >
                <Icon name="chevron-down" size={14} style={{ transform: 'rotate(90deg)' }} />
                All tickets
              </button>

              <span
                title={thread.ticket.categoryLabel}
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-ring)',
                }}
              >
                <Icon name={categoryIcon(thread.ticket.category)} size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{thread.ticket.subject}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                    {thread.ticket.reference}
                  </span>{' '}
                  · {thread.ticket.categoryLabel} · {thread.ticket.who}
                  {thread.ticket.isGuest && ' · not signed in'}
                  <br />
                  raised {formatDateTime(thread.ticket.createdAt)}
                </div>
              </div>
              <StatusPill status={thread.ticket.status} admin />
            </div>

            <CustomerStrip customer={thread.customer} ticket={thread.ticket} />

            {/* Who is dealing with it, and how to change that. Sits above the
                conversation because it decides whether the reply box below is
                usable at all. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: 9,
                border: '1px solid var(--border)',
                background: mine ? 'var(--accent-soft)' : 'var(--bg-subtle)',
              }}
            >
              <Icon name="user" size={14} style={{ color: mine ? 'var(--accent)' : 'var(--text-muted)' }} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {thread.ticket.assignedTo
                  ? mine
                    ? 'You are dealing with this'
                    : // Falls back to a description rather than printing the
                      // value. The panel read "null is dealing with this" for
                      // as long as the query behind it forgot to fetch the
                      // name, and a screen that prints null is a screen nobody
                      // trusts afterwards.
                      `${thread.ticket.assignedName || 'Somebody on the team'} is dealing with this`
                  : 'Nobody has picked this up'}
              </span>

              <span style={{ flex: 1 }} />

              {!thread.ticket.assignedTo && (
                <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy} onClick={() => assign(null)}>
                  Take it
                </button>
              )}

              {mine && (
                <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={release}>
                  Hand it back
                </button>
              )}

              {/* Only an administrator can pass a ticket to somebody else —
                  including to themselves, which is how they take one that a
                  colleague is already holding. */}
              {/* How urgent, shown and not set.

                  It was a live dropdown on the thread, so the ordering of
                  everybody's queue could be changed by anyone who happened to
                  have the ticket open — and silently, since nothing announces
                  it. Priority decides what gets answered first, which makes it
                  a decision about the queue rather than about this one
                  conversation. Read-only here; the endpoint still exists for
                  wherever that decision ends up being made deliberately. */}
              {thread.ticket.priority && thread.ticket.priority !== 'normal' && (
                <span
                  title="How this ticket is prioritised"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: 999,
                    textTransform: 'capitalize',
                    color: PRIORITIES.find((x) => x.value === thread.ticket.priority)?.colour || 'var(--text-muted)',
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {PRIORITIES.find((x) => x.value === thread.ticket.priority)?.label || thread.ticket.priority}
                </span>
              )}

              {user?.isAdmin && staff.some((person) => person.id !== user?.id) && (
                <select
                  className="input"
                  value=""
                  disabled={busy}
                  onChange={(e) => e.target.value && assign(Number(e.target.value))}
                  style={{ fontSize: 12, width: 'auto', padding: '5px 8px' }}
                >
                  <option value="">Transfer to…</option>
                  {/* Everybody but you.
                      Transferring a ticket to yourself is not a transfer — it
                      is Take it, which is its own button a few inches away and
                      only appears when the ticket is unheld. Two controls
                      doing the same thing under different names is how one of
                      them gets pressed by mistake. */}
                  {staff
                    .filter((person) => person.id !== user?.id)
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <SupportThread
              admin
              ticket={thread.ticket}
              messages={thread.messages}
              busy={busy}
              onRefresh={refreshThread}
              onEdit={async (message, body) => {
                const res = await api.patch(`/admin/support/messages/${message.id}`, { message: body });
                setThread((prev) => ({ ...prev, messages: res.data.messages }));
              }}
              // No reply box unless it is yours to answer. Offering one and
              // refusing the send would be worse than not offering it.
              currentUserId={user?.id ?? null}
              onDelete={async (message) => {
                const ok = await confirm({
                  title: 'Delete this note?',
                  body: 'It is only visible to the support team, and it will be gone for good.',
                  confirmLabel: 'Delete it',
                  danger: true,
                });
                if (!ok) return;
                try {
                  const res = await api.delete(`/admin/support/messages/${message.id}`);
                  setThread((prev) => ({ ...prev, messages: res.data.messages }));
                } catch (err) {
                  toast(err.message, 'error');
                }
              }}
              canReply={mine}
              onReply={async (message, files, onProgress) => {
                let payload = { message };
                if (files?.length) {
                  payload = new FormData();
                  payload.append('message', message);
                  for (const file of files) payload.append('attachments', file);
                }
                const res = await api.post(
                  `/admin/support/tickets/${openId}/reply`,
                  payload,
                  onProgress
                    ? {
                        onUploadProgress: (event) => {
                          if (!event.total) return;
                          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
                        },
                      }
                    : undefined
                );
                setThread((prev) => ({ ...prev, ticket: { ...prev.ticket, status: res.data.status }, messages: res.data.messages }));
                loadList();
              }}
              extraActions={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {thread.planRequest && (
                    <PlanRequestPanel
                      request={thread.planRequest}
                      onChanged={() => {
                        loadThread(openId);
                        loadList();
                      }}
                    />
                  )}
                  {/* A note for whoever picks this up next. Never sent, never
                      emailed, and filtered out of everything the customer can
                      read — the server drops notes unless the caller asks for
                      them, so this cannot leak by being forgotten. */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <textarea
                      className="input"
                      rows={2}
                      maxLength={5000}
                      placeholder="Internal note — only the support team sees this"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      style={{ resize: 'vertical', fontSize: 12.5, flex: 1 }}
                    />
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                      disabled={!note.trim() || busy}
                      onClick={async () => {
                        try {
                          const res = await api.post(`/admin/support/tickets/${openId}/note`, { message: note.trim() });
                          setThread((prev) => ({ ...prev, messages: res.data.messages }));
                          setNote('');
                        } catch (err) {
                          toast(err.message, 'error');
                        }
                      }}
                    >
                      Add note
                    </button>
                  </div>

                  {/* Close and Delete on a row of their own.
                      They used to sit in the same flex row as the note box, and
                      a flex row stretches its children to the tallest of them —
                      so a two-line textarea made both buttons twice the height
                      of every other button in the app, with their labels
                      wrapping. alignItems keeps them their own size whatever
                      ends up beside them. */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12.5, gap: 6, whiteSpace: 'nowrap' }}
                      disabled={busy}
                      onClick={() => setStatus(thread.ticket.status !== 'closed')}
                    >
                      <Icon name={thread.ticket.status === 'closed' ? 'repeat' : 'lock'} size={13} />
                      {thread.ticket.status === 'closed' ? 'Open it again' : 'Close ticket'}
                    </button>

                    {/* Deleting removes the conversation and every image in
                        it, for good. Kept beside the close button but styled
                        apart, and asks for the reference to be typed — closing
                        is the ordinary action and this one is not. */}
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12.5, gap: 6, color: 'var(--red)', marginLeft: 'auto', whiteSpace: 'nowrap' }}
                      disabled={busy}
                      onClick={remove}
                    >
                      <Icon name="trash" size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              }
            />
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
