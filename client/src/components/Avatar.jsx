const NO_AVATAR_COLOR = '#3b82f6';

function initialsFor(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const initials = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

// `hue` marks somebody whose identity is deliberately withheld — a support
// operator looking at a queue of tickets. It draws a plain coloured disc with a
// figure in it rather than initials, because initials taken from "Customer
// 7K2Q" would be a lie dressed as information: they look like a person's
// initials and are not. The colour is stable per person, so the same customer
// is recognisable down a list without being named.
export default function Avatar({ name, avatarUrl, size = 36, hue = null }) {
  if (hue !== null && !avatarUrl) {
    return (
      <div
        title="Identity hidden"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `hsl(${hue} 42% 46%)`,
          color: 'white',
          flexShrink: 0,
        }}
      >
        <svg
          width={size * 0.55}
          height={size * 0.55}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    );
  }
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name || 'Avatar'}
        width={size}
        height={size}
        style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: NO_AVATAR_COLOR,
        color: 'white',
        fontWeight: 700,
        fontSize: size * 0.4,
        flexShrink: 0,
      }}
    >
      {initialsFor(name)}
    </div>
  );
}
