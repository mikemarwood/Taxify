export function SkeletonRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
      <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 10 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="skeleton" style={{ width: '40%', height: 12 }} />
        <div className="skeleton" style={{ width: '25%', height: 10 }} />
      </div>
      <div className="skeleton" style={{ width: 70, height: 16 }} />
    </div>
  );
}

export function SkeletonList({ rows = 5 }) {
  return (
    <div className="card scrollbar-slim" style={{ overflow: 'hidden' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ borderBottom: i < rows - 1 ? '1px solid var(--border)' : 'none' }}>
          <SkeletonRow />
        </div>
      ))}
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="skeleton" style={{ width: '50%', height: 12 }} />
      <div className="skeleton" style={{ width: '70%', height: 26 }} />
    </div>
  );
}
