import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { formatDateTime } from '../lib/dates.js';

// Money that has arrived.
//
// Nothing in the admin panel said what had been taken. The figure existed only
// in Stripe, which meant leaving the app to answer the most ordinary question
// there is about a paid product — and the answer arrived without any of the
// account context that makes it useful.
//
// Five rows by default, because that is the glanceable version and this sits
// among other panels. Opening it pages through the lot, twenty at a time.
function money(cents, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'AUD').toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

// A renewal and a one-off plan change are different events, and reading the
// description to work out which is what the badge saves.
function kindLabel(kind) {
  return kind === 'plan_change' ? 'Plan change' : 'Subscription';
}

export default function RecentPayments() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get(`/admin/payments?page=${page}`)
      .then((res) => alive && setData(res.data))
      // A panel that cannot load is a panel that shows nothing, not an error
      // across the whole stats page.
      .catch(() => alive && setData({ payments: [], total: 0 }));
    return () => {
      alive = false;
    };
  }, [page]);

  if (!data) return null;

  const rows = all ? data.payments : data.payments.slice(0, 5);
  const pages = Math.ceil((data.total || 0) / (data.perPage || 20));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <Icon name="cash" size={17} style={{ color: 'var(--emerald)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>Payments received</span>

        {/* The two figures worth having at a glance. Counted in the database
            over the whole table, not by adding up the twenty rows below. */}
        {data.week && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {money(data.week.cents, data.payments[0]?.currency)} this week
            <span style={{ opacity: 0.5 }}> · </span>
            {money(data.month.cents, data.payments[0]?.currency)} in 30 days
          </span>
        )}

        <span style={{ flex: 1 }} />

        {data.total > 5 && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '5px 11px' }}
            onClick={() => {
              setAll((v) => !v);
              setPage(1);
            }}
          >
            {all ? 'Show less' : `Show all ${data.total}`}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 18, fontSize: 13, color: 'var(--text-muted)' }}>
          Nothing yet. Payments appear here the moment Stripe confirms them.
        </div>
      ) : (
        <div>
          {rows.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 18px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ minWidth: 150, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>
                  {p.name || p.email || 'A closed account'}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {p.email && p.name ? `${p.email} · ` : ''}
                  {formatDateTime(p.paidAt)}
                </span>
              </span>

              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  padding: '3px 9px',
                  borderRadius: 999,
                  whiteSpace: 'nowrap',
                  color: p.kind === 'plan_change' ? 'var(--accent)' : 'var(--text-muted)',
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border)',
                }}
              >
                {kindLabel(p.kind)}
              </span>

              <span
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: 'var(--emerald)',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 92,
                  textAlign: 'right',
                }}
              >
                {money(p.amountCents, p.currency)}
              </span>

              {p.invoiceUrl && (
                <a
                  href={p.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the invoice in Stripe"
                  style={{ color: 'var(--text-muted)', display: 'flex' }}
                >
                  <Icon name="file" size={14} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {all && pages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 18px',
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px' }}
            disabled={page <= 1}
            onClick={() => setPage((v) => Math.max(1, v - 1))}
          >
            Back
          </button>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            Page {page} of {pages}
          </span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px' }}
            disabled={page >= pages}
            onClick={() => setPage((v) => v + 1)}
          >
            More
          </button>
        </div>
      )}
    </div>
  );
}
