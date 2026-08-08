import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from './../lib/ConfirmContext.jsx';
import SupportThread, { StatusPill } from './SupportThread.jsx';
import { formatDateTime } from '../lib/dates.js';
import { playInfo } from '../lib/sounds.js';
import PlanRequestPanel from './PlanRequestPanel.jsx';

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
        borderLeft: `3px solid ${ticket.status === 'awaiting_support' ? 'var(--amber)' : 'var(--border)'}`,
      }}
    >
      <Avatar name={ticket.who} avatarUrl={ticket.avatarUrl} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ticket.subject}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ticket.who || 'Someone'}
          {ticket.isGuest && ' · guest'} · {ticket.categoryLabel}
        </div>
      </div>
    </button>
  );
}

export default function SupportTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tickets, setTickets] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [busy, setBusy] = useState(false);
  // How many were waiting last time, so a new one arriving can be heard rather
  // than only seen by somebody already looking at the screen.
  const waiting = useRef(null);

  function loadList() {
    api
      .get('/admin/support/tickets')
      .then((res) => {
        const list = res.data.tickets;
        const needing = list.filter((t) => t.status === 'awaiting_support').length;
        if (waiting.current !== null && needing > waiting.current) playInfo();
        waiting.current = needing;
        setTickets(list);
      })
      .catch((err) => {
        toast(err.message, 'error');
        setTickets([]);
      });
  }

  function loadThread(id) {
    api
      .get(`/admin/support/tickets/${id}`)
      .then((res) => setThread(res.data))
      .catch((err) => toast(err.message, 'error'));
  }

  useEffect(() => {
    loadList();
    const timer = setInterval(loadList, POLL_MS);
    return () => clearInterval(timer);
  }, []);

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

  const needing = tickets.filter((t) => t.status === 'awaiting_support');
  const others = tickets.filter((t) => t.status !== 'awaiting_support');

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(230px, 300px) 1fr', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Needs a reply</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 999,
              color: needing.length ? '#fff' : 'var(--text-muted)',
              background: needing.length ? 'var(--amber)' : 'var(--bg-subtle)',
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
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{thread.ticket.subject}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                    {thread.ticket.reference}
                  </span>{' '}
                  · {thread.ticket.categoryLabel} · {thread.ticket.who}
                  {thread.ticket.email && ` · ${thread.ticket.email}`}
                  {thread.ticket.isGuest && ' · not signed in'}
                  <br />
                  raised {formatDateTime(thread.ticket.createdAt)}
                </div>
              </div>
              <StatusPill status={thread.ticket.status} admin />
            </div>

            <SupportThread
              admin
              ticket={thread.ticket}
              messages={thread.messages}
              busy={busy}
              onRefresh={() => loadThread(openId)}
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
                  <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12.5, gap: 6 }}
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
                      style={{ fontSize: 12.5, gap: 6, color: 'var(--red)', marginLeft: 'auto' }}
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
  );
}
