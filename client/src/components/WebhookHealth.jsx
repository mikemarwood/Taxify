import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';

// Whether the Stripe webhook is actually working.
//
// Not "is a secret set" — that was true throughout the outage that left a
// paying customer locked out of their own account. Three things have to hold,
// and each fails in a way the other two cannot see:
//
//   Stripe has an endpoint pointed at us.
//   It is subscribed to every event we act on.
//   What it sends is being accepted.
//
// The middle one is the quiet killer: a missing event is reported as a
// successful delivery by Stripe, because it never sent it, and the app never
// learns what happened. The last one cannot be read from Stripe at all — a
// rotated signing secret leaves the endpoint looking perfectly healthy there
// while every delivery is rejected — so it is answered from our side, by
// recording the last event the webhook actually verified.
function ago(iso) {
  if (!iso) return null;
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(seconds)) return null;
  if (seconds < 90) return 'just now';
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

function Line({ ok, warn, children }) {
  const tone = ok ? 'var(--emerald)' : warn ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.55 }}>
      <span style={{ color: tone, flexShrink: 0, marginTop: 1 }}>
        <Icon name={ok ? 'check-circle' : warn ? 'info' : 'alert'} size={14} />
      </span>
      <span>{children}</span>
    </div>
  );
}

export default function WebhookHealth() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.get('/admin/stripe/webhook-health');
      setData(res.data);
    } catch (err) {
      setData({ error: err.message });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return null;

  const seenAgo = ago(data.lastEventAt);
  // A delivery within the last week is evidence the whole path works. Longer
  // than that on a live site is not proof of failure — it may simply be quiet —
  // so it is raised as something to check rather than called broken.
  const recent = data.lastEventAt && Date.now() - new Date(data.lastEventAt).getTime() < 7 * 86400000;
  const healthy = data.secretSet && data.matching > 0 && data.missing?.length === 0 && recent;

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Icon name="bolt" size={17} style={{ color: healthy ? 'var(--emerald)' : 'var(--amber)' }} />
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>Webhook</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            padding: '3px 9px',
            borderRadius: 999,
            color: healthy ? 'var(--emerald)' : 'var(--red)',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
          }}
        >
          {healthy ? 'Working' : 'Needs a look'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={load}>
          {busy && <span className="spinner" />}
          Check again
        </button>
      </div>

      {data.error ? (
        <Line ok={false}>{data.error}</Line>
      ) : (
        <>
          <Line ok={data.secretSet}>
            {data.secretSet
              ? 'A signing secret is set.'
              : 'No signing secret. Every delivery will be rejected — set it on this page.'}
          </Line>

          <Line ok={data.matching > 0} warn={Boolean(data.problem)}>
            {data.problem
              ? `Could not ask Stripe which endpoints exist: ${data.problem}`
              : data.matching > 0
              ? `Stripe has ${data.matching === 1 ? 'an endpoint' : `${data.matching} endpoints`} pointed at ${data.origin}.`
              : `Stripe has no endpoint pointed at ${data.origin}. Nothing will ever reach this site.`}
          </Line>

          <Line ok={data.missing?.length === 0}>
            {data.missing?.length === 0 ? (
              `All ${data.required?.length} events we act on are switched on.`
            ) : (
              <>
                <strong>{data.missing.length} event{data.missing.length === 1 ? ' is' : 's are'} missing.</strong> Stripe
                reports these as delivered because it never sends them, so nothing here will ever notice. Add them to
                the endpoint:
                <div style={{ marginTop: 5, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>
                  {data.missing.join(', ')}
                </div>
              </>
            )}
          </Line>

          {/* The one thing Stripe cannot tell us. An endpoint can look perfect
              in the dashboard while every delivery is rejected on a signing
              secret that no longer matches. */}
          <Line ok={recent} warn={Boolean(data.lastEventAt) && !recent}>
            {data.lastEventAt ? (
              <>
                Last delivery accepted <strong>{seenAgo}</strong>
                {data.lastEventType ? ` (${data.lastEventType})` : ''}.
                {!recent && ' Quiet for over a week — worth a test payment if you expected activity.'}
              </>
            ) : (
              <>
                <strong>Nothing has ever been accepted from Stripe.</strong> If the endpoint above exists, the signing
                secret here does not match the one Stripe is signing with.
              </>
            )}
          </Line>
        </>
      )}
    </div>
  );
}
