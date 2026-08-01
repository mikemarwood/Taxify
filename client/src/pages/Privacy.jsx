import { Link } from 'react-router-dom';
import { formatDateLong } from '../lib/dates.js';

export default function Privacy() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '48px 20px' }}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <img src="/logo.svg" alt="Taxify" width="32" height="32" />
          <span style={{ fontWeight: 800, fontSize: 20 }}>Taxify</span>
        </div>

        <div className="card" style={{ padding: 32 }}>
          <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Privacy Policy</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 24px' }}>
            Last updated {formatDateLong(new Date())}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              This is placeholder text and has not been reviewed by a lawyer. Replace it with your actual Privacy
              Policy before relying on it.
            </p>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>1. What we collect</h2>
              <p style={{ margin: 0 }}>
                Account details you provide (name, email, and optionally country, business name, and how you heard
                about us), plus the expenses, categories, and receipts you choose to add.
              </p>
            </section>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>2. How we use it</h2>
              <p style={{ margin: 0 }}>
                To provide the service (storing and displaying your expense records), to email you account-related
                messages (login codes, activation links, billing notices), and to process payments via Stripe.
              </p>
            </section>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>3. Sharing</h2>
              <p style={{ margin: 0 }}>
                We don't sell your data. It's only shared with the service providers needed to run Taxify (e.g.
                payment processing, email delivery), and with anyone you explicitly invite to your account (family
                member or accountant).
              </p>
            </section>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>4. Your choices</h2>
              <p style={{ margin: 0 }}>
                You can update or remove most of your account details at any time from Account settings, and can
                delete individual expenses, receipts, or your whole account.
              </p>
            </section>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 20, textAlign: 'center' }}>
          <Link to="/register" style={{ color: 'var(--blue)', fontWeight: 600 }}>
            Back to sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
