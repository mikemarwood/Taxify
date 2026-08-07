import EntityManager from '../components/EntityManager.jsx';
import { useEntities } from '../lib/EntityContext.jsx';

// Your books.
//
// This used to sit above the Categories page's own heading, which made that
// page two features stacked and put the thing that decides where everything
// files behind the title of something else. Books are the scoping unit for
// every expense, receipt, report and lodgement — they warrant their own page.

export default function Books() {
  const { allowance } = useEntities();

  const businesses = allowance?.businesses ?? 0;
  const left = allowance?.businessesLeft ?? 0;

  return (
    <div style={{ maxWidth: 940 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Your books</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          Every expense, category, report and lodgement belongs to one of these.
        </p>
      </div>

      {/* What the plan allows, said before somebody types a name and is
          refused. The manager below repeats the refusal at the point of
          creation; this is so nobody has to discover the limit by hitting it. */}
      {allowance && (
        <div
          style={{
            marginBottom: 18,
            padding: '11px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-inset)',
            border: '1px solid var(--border)',
            fontSize: 12.5,
            color: 'var(--text-muted)',
            lineHeight: 1.55,
          }}
        >
          {businesses === 0 ? (
            <>
              Your plan covers <strong style={{ color: 'var(--text)' }}>your own tax</strong>. Small Business adds up
              to two businesses alongside it, each kept separately with its own reports and lodgement.
            </>
          ) : (
            <>
              Your plan covers your own tax plus{' '}
              <strong style={{ color: 'var(--text)' }}>
                {businesses} business{businesses === 1 ? '' : 'es'}
              </strong>
              {left > 0 ? (
                <>
                  {' '}
                  — {left} still to use.
                </>
              ) : (
                <> — all of them in use.</>
              )}
            </>
          )}
        </div>
      )}

      <EntityManager />
    </div>
  );
}
