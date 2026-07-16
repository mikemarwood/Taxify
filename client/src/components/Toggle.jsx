export default function Toggle({ checked, onChange, disabled, label }) {
  return (
    <label className="switch" style={{ opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" />
      {label && <span className="switch-label">{label}</span>}
    </label>
  );
}
