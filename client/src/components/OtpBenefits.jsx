const BENEFITS = [
  { icon: '🛡️', text: 'Blocks anyone who guesses or steals your password — they still can’t get in without your email.' },
  { icon: '📬', text: 'A fresh 4-digit code is sent to your inbox each time you log in, valid for just 5 minutes.' },
  { icon: '🚫', text: 'Three wrong codes automatically locks login for 60 minutes, stopping brute-force attempts.' },
  { icon: '⚙️', text: 'Turn it on or off any time from Security settings — no commitment.' },
];

export default function OtpBenefits() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '4px 0 20px' }}>
      {BENEFITS.map((b) => (
        <div key={b.text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 17, lineHeight: 1.4 }}>{b.icon}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{b.text}</span>
        </div>
      ))}
    </div>
  );
}
