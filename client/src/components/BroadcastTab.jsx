import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import { SkeletonList } from './Skeletons.jsx';
import { onCasedInput } from '../lib/casedInput.js';
import { sentenceCaseLive } from '../lib/textCase.js';

// Writing to everybody.
//
// The one screen in this panel where a mistake is delivered, cannot be recalled
// and is read by every customer at once. So it is built around the two things
// that stop that: the number of people a choice reaches, shown before anything
// is written rather than after; and a preview of the actual message with that
// number beside it, which has to be passed through deliberately before anything
// is sent.

const MAX_SUBJECT = 140;
const MAX_BODY = 5000;

function Bar({ value, total }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-inset)', overflow: 'hidden' }}>
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 4,
          background: 'var(--accent)',
          transition: 'width .35s ease',
        }}
      />
    </div>
  );
}

export default function BroadcastTab() {
  const toast = useToast();
  const [audiences, setAudiences] = useState(null);
  const [audience, setAudience] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  // null while idle; an object once a send has started, so the form can be
  // replaced by progress rather than sitting there invitingly.
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    api
      .get('/admin/broadcast/audiences')
      .then((res) => setAudiences(res.data))
      .catch((err) => {
        toast(err.message, 'error');
        setAudiences({ audiences: [], batchSize: 20 });
      });
  }, [toast]);

  const chosen = audiences?.audiences.find((a) => a.key === audience) || null;
  const ready = Boolean(chosen && chosen.count > 0 && subject.trim().length >= 4 && body.trim().length >= 20);

  async function send() {
    setConfirming(false);
    setProgress({ total: chosen.count, sent: 0, failed: 0, done: false });

    try {
      // Read as it arrives rather than awaited as a whole. A few hundred
      // emails takes minutes, and a request that hangs for minutes is one
      // somebody reloads — which on a send is the worst thing they could do.
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, subject, body }),
      });

      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.error || 'That could not be sent');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // The stream is newline-delimited JSON, and a chunk can end mid-line, so
      // the tail is kept back until the newline that completes it arrives.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const update = JSON.parse(line);
          setProgress((prev) => ({ ...prev, ...update }));
        }
      }
    } catch (err) {
      toast(err.message, 'error');
      setProgress((prev) => (prev ? { ...prev, done: true, error: err.message } : null));
    }
  }

  if (!audiences) return <SkeletonList rows={3} />;

  if (progress) {
    const finished = progress.done;
    const failedCount = Array.isArray(progress.failed) ? progress.failed.length : progress.failed || 0;
    return (
      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {finished ? 'Sent' : 'Sending…'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            {progress.sent} of {progress.total}
            {failedCount > 0 && <span style={{ color: 'var(--red)' }}> · {failedCount} could not be delivered</span>}
          </div>
        </div>

        <Bar value={progress.sent} total={progress.total} />

        {!finished && (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Going out {audiences.batchSize} at a time with a pause between, so the mail server is not handed several
            hundred messages at once. Leave this page open — closing it stops the send where it is.
          </div>
        )}

        {finished && Array.isArray(progress.failed) && progress.failed.length > 0 && (
          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Not delivered</div>
            {progress.failed.slice(0, 20).map((f) => (
              <div key={f.email} style={{ color: 'var(--text-muted)' }}>
                {f.email} — {f.error}
              </div>
            ))}
          </div>
        )}

        {finished && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13, alignSelf: 'flex-start' }}
            onClick={() => {
              setProgress(null);
              setSubject('');
              setBody('');
            }}
          >
            Write another
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Who it goes to</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Only accounts that have opened their activation link. An address nobody has confirmed may belong to
            somebody who has never heard of us.
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {audiences.audiences.map((a) => {
            const on = audience === a.key;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => setAudience(a.key)}
                disabled={a.count === 0}
                style={{
                  textAlign: 'left',
                  padding: '11px 13px',
                  borderRadius: 10,
                  cursor: a.count === 0 ? 'default' : 'pointer',
                  opacity: a.count === 0 ? 0.55 : 1,
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  borderLeft: `3px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'var(--accent-soft)' : 'var(--bg-card)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{a.count}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{a.label}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 2 }}>
                  {a.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label" htmlFor="broadcast-subject">
            Subject
          </label>
          <input
            id="broadcast-subject"
            className="input"
            maxLength={MAX_SUBJECT}
            value={subject}
            onChange={onCasedInput(sentenceCaseLive, setSubject)}
            placeholder="End of financial year is coming"
          />
        </div>

        <div>
          <label className="label" htmlFor="broadcast-body">
            Message
          </label>
          {/* Sentence capitals as it is typed, and whitespace left alone, so a
              blank line between two paragraphs survives being written. */}
          <textarea
            id="broadcast-body"
            className="input"
            rows={9}
            maxLength={MAX_BODY}
            value={body}
            onChange={onCasedInput(sentenceCaseLive, setBody)}
            placeholder={'A blank line starts a new paragraph.\n\nWrite it the way you would write to one person — everybody reading it is one person.'}
            style={{ resize: 'vertical', lineHeight: 1.6 }}
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
            {body.trim().length} characters · a blank line starts a new paragraph
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            disabled={!ready}
            onClick={() => setConfirming(true)}
          >
            Preview and send
          </button>
          {chosen && (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {chosen.count} recipient{chosen.count === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {/* The preview, and the only place the send can be started from.

          It shows the message as it will arrive and the number of people it
          reaches in the same view, because those two facts are only alarming
          together — a good message to the wrong list and a bad message to the
          right one both look fine on their own. */}
      {confirming && chosen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Preview this email"
          onClick={() => setConfirming(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2600,
            background: 'rgba(6, 10, 18, .6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: '90dvh',
              overflowY: 'auto',
              padding: 22,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Send this to {chosen.count} people?</h2>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                {chosen.label} · {chosen.hint}
              </p>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 13px', borderBottom: '1px solid var(--border)', background: 'var(--bg-inset)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Subject</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{subject.trim()}</div>
              </div>
              <div style={{ padding: '13px', background: '#fff', color: '#1f2937' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>Hi [their first name],</div>
                {body
                  .trim()
                  .split(/\n{2,}/)
                  .filter(Boolean)
                  .map((paragraph, i) => (
                    <p key={i} style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>
                      {paragraph}
                    </p>
                  ))}
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              This cannot be recalled once it starts. It goes out {audiences.batchSize} at a time, so a large send takes
              a few minutes.
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={send}>
                Send to {chosen.count}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
