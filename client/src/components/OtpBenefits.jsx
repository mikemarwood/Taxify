import Icon from './Icon.jsx';

const BENEFITS = [
  { icon: 'shield', text: 'Blocks anyone who guesses or steals your password — they still can’t get in without your email.' },
  { icon: 'mail', text: 'A fresh 4-digit code is sent to your inbox each time you log in, valid for just 5 minutes.' },
  { icon: 'ban', text: 'Three wrong codes automatically locks login for 60 minutes, stopping brute-force attempts.' },
  { icon: 'lock', text: 'Keeps your expenses and receipts protected even if your password ever leaks.' },
];

export default function OtpBenefits() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '4px 0 20px' }}>
      {BENEFITS.map((b) => (
        <div key={b.text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Icon name={b.icon} size={16} style={{ color: 'var(--violet)', marginTop: 2 }} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{b.text}</span>
        </div>
      ))}
    </div>
  );
}
