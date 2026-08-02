import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { unconvertedCount } from '../lib/money.js';

// A total that is quietly missing three expenses is worse than one that says
// so. Any foreign expense we could not convert is excluded from the sums —
// which is the honest thing to do with a figure we cannot justify — but it has
// to be visible, and fixable, rather than a silent shortfall.
export default function UnconvertedNotice({ expenses }) {
  const count = unconvertedCount(expenses);
  if (count === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 18,
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(245, 158, 11, 0.10)',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <Icon name="alert" size={16} style={{ color: 'var(--amber)', marginTop: 1, flexShrink: 0 }} />
      <span>
        <strong>
          {count} {count === 1 ? 'expense is' : 'expenses are'} not counted in these totals.
        </strong>{' '}
        {count === 1 ? 'It was' : 'They were'} recorded in another currency and we couldn't establish an exchange
        rate, so counting {count === 1 ? 'it' : 'them'} at face value would overstate your figures. Open{' '}
        {count === 1 ? 'it' : 'each one'} from <Link to="/expenses" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          All expenses
        </Link>{' '}
        and enter the rate you used.
      </span>
    </div>
  );
}
