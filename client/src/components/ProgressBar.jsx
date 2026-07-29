// A determinate upload bar. Below ~2% the fill would be a sliver too small to
// read as progress, so it starts at a visible minimum — the point is to show
// that something is happening, not to be a measuring instrument.
export default function ProgressBar({ value = 0, label, height = 6 }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-muted)',
            marginBottom: 6,
          }}
        >
          <span>{label}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Upload progress'}
        style={{
          height,
          width: '100%',
          borderRadius: 999,
          background: 'var(--bg-inset)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.max(pct, 2)}%`,
            borderRadius: 999,
            background: 'var(--gradient-brand)',
            transition: 'width 0.18s var(--ease-standard)',
          }}
        />
      </div>
    </div>
  );
}
