import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '48px 20px' }}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <img src="/logo.svg" alt="Taxify" width="32" height="32" />
          <span style={{ fontWeight: 800, fontSize: 20 }}>Taxify</span>
        </div>

        <div className="card" style={{ padding: 32 }}>
          <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Terms of Service</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 24px' }}>
            Last updated {new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              This is placeholder text and has not been reviewed by a lawyer. Replace it with your actual Terms of
              Service before relying on it.
            </p>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>1. Using Taxify</h2>
              <p style={{ margin: 0 }}>
                Taxify is provided to help you track tax-deductible expenses and receipts. By creating an account you
                agree to use the service only for lawful purposes and to keep your login credentials secure.
              </p>
            </section>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>2. Your data</h2>
              <p style={{ margin: 0 }}>
                Expenses, categories, and receipts you upload remain yours. You're responsible for the accuracy of
                the records you keep — Taxify is a tracking tool, not tax advice.
              </p>
            </section>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>3. Subscriptions &amp; trials</h2>
              <p style={{ margin: 0 }}>
                New accounts start on a free trial. Continued access after the trial requires an active paid
                subscription, billed and managed through Stripe.
              </p>
            </section>
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>4. Changes</h2>
              <p style={{ margin: 0 }}>
                These terms may be updated from time to time. Continued use of Taxify after a change means you accept
                the updated terms.
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
