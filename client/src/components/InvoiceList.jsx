import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatDateShort } from '../lib/dates.js';
import Icon from './Icon.jsx';

// Every invoice Stripe has raised for this account, with the PDF served from
// us rather than from a Stripe link that needs a session to open.

function money(cents, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

const STATUS = {
  paid: { label: 'Paid', color: 'var(--emerald)' },
  open: { label: 'Due', color: 'var(--amber)' },
  uncollectible: { label: 'Unpaid', color: 'var(--red)' },
  void: { label: 'Void', color: 'var(--text-muted)' },
  draft: { label: 'Draft', color: 'var(--text-muted)' },
};

export default function InvoiceList() {
  const [invoices, setInvoices] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get('/billing/invoices')
      .then((res) => setInvoices(res.data.invoices || []))
      .catch(() => setFailed(true));
  }, []);

  // Nothing bought yet. A heading over an empty box invites the question of
  // whether something is broken, so there is simply nothing here.
  if (failed || (invoices && invoices.length === 0)) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Invoices</div>

      {invoices === null ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invoices.map((inv) => {
            const status = STATUS[inv.status] || STATUS.draft;
            return (
              <div
                key={inv.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '11px 13px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <span style={{ minWidth: 130, flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{inv.number || inv.id}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {inv.created ? formatDateShort(inv.created) : ''}
                    {inv.description ? ` · ${inv.description}` : ''}
                  </span>
                </span>

                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {money(inv.amountDue, inv.currency)}
                </span>

                <span style={{ fontSize: 11.5, fontWeight: 700, color: status.color, minWidth: 46 }}>
                  {status.label}
                </span>

                {/* A plain link, not a fetch — the browser's own download
                    handling is better than anything rebuilt with a blob. */}
                <a
                  className="btn btn-ghost"
                  href={`/api/billing/invoices/${encodeURIComponent(inv.id)}/pdf`}
                  style={{ fontSize: 12, padding: '5px 11px', gap: 6, textDecoration: 'none' }}
                >
                  <Icon name="download" size={14} />
                  PDF
                </a>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Every invoice is kept with your account, so they stay available here after they leave your inbox.
      </p>
    </div>
  );
}
