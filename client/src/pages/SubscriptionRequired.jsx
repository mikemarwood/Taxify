import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

export default function SubscriptionRequired() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const expired = user?.subscriptionStatus === 'expired' || user?.subscriptionStatus === 'canceled';

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 20px' }}>
      <div className="card" style={{ maxWidth: 460, width: '100%', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <h1 style={{ fontSize: 21, margin: '0 0 10px' }}>
          {expired ? 'Your trial has ended' : 'Subscription required'}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 24px' }}>
          {isOwner
            ? 'Your data is safe and waiting for you. Subscribe to a yearly plan to keep uninterrupted access to your expenses, reports, and receipts.'
            : 'Access for this account is managed by your account holder. Ask them to subscribe to restore access.'}
        </p>
        {isOwner && (
          <Link to="/account" className="btn btn-primary">
            Go to billing
          </Link>
        )}
      </div>
    </div>
  );
}
