import Icon from './Icon.jsx';

export default function CategoryBadge({ category }) {
  if (!category) {
    return (
      <span className="category-badge" style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)' }}>
        <span className="category-badge-name">Uncategorised</span>
        <span className="category-badge-dash" aria-hidden="true">—</span>
      </span>
    );
  }
  return (
    <span
      className="category-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12.5,
        fontWeight: 600,
        padding: '5px 11px',
        borderRadius: 999,
        color: category.color,
        background: `${category.color}22`,
        border: `1px solid ${category.color}55`,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name={category.icon} size={15} strokeWidth={1.9} />
      {/* Wrapped so a narrow screen can drop the words and keep the colour and
          the icon, which are what actually identify a category at a glance.
          A name like 'Software Subscriptions' took a whole line on every row. */}
      <span className="category-badge-name">{category.name}</span>
    </span>
  );
}
