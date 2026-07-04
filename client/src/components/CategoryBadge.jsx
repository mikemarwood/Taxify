export default function CategoryBadge({ category }) {
  if (!category) {
    return (
      <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)' }}>
        Uncategorised
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 999,
        color: category.color,
        background: `${category.color}22`,
        border: `1px solid ${category.color}55`,
        whiteSpace: 'nowrap',
      }}
    >
      {category.name}
    </span>
  );
}
