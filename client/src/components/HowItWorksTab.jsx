import Icon from './Icon.jsx';

// How the system actually works, drawn.
//
// This is documentation that happens to be rendered. Its value is that the
// rules which currently exist only as comments in the code — an invitation may
// create a login but never write to one; nothing but the Stripe webhook moves a
// plan — become visible to whoever is running the business rather than only to
// whoever is reading the source.
//
// Each step names the file that implements it, so it stays a map of the code
// rather than a drawing that quietly goes stale. When one stops matching the
// other, the mismatch is the bug.

const FLOWS = [
  {
    title: 'Somebody signs up',
    icon: 'user',
    steps: [
      { label: 'Registers', detail: 'Name, email, where they are, a plan', file: 'auth.routes.js' },
      { label: 'Activation email', detail: 'The account exists but cannot sign in yet', file: 'mailer.js' },
      { label: 'Activates', detail: '14-day trial starts', file: 'auth.routes.js' },
      { label: 'Books seeded', detail: 'A default set of books and the standard categories', file: 'entities.js' },
      { label: 'Subscribes, or lapses', detail: 'Stripe decides which, not us', file: 'billing.routes.js' },
    ],
    rule: 'An account that never activates never gets a trial, so an abandoned sign-up costs nothing and expires on its own.',
  },
  {
    title: 'A client shares with their accountant',
    icon: 'briefcase',
    branch: {
      at: 1,
      left: { label: 'No account yet', detail: 'They set a password and one is created', file: 'auth.routes.js' },
      right: { label: 'Already a customer', detail: 'They are linked — nothing is written to their login', file: 'accountantInvites.js' },
    },
    steps: [
      { label: 'Client invites by email', detail: 'Choosing which books, which years, read or write', file: 'Account.jsx' },
      { label: 'They follow the link', detail: 'Two branches from here', file: 'AcceptInvite.jsx' },
      { label: 'Access granted', detail: 'One assignment row, scoped to what was chosen', file: 'accountants.js' },
      { label: 'Clock starts on first open', detail: 'Not on acceptance — an unopened window is not spent', file: 'accountants.js' },
    ],
    rule: 'An invitation proves control of a mailbox and nothing more. It may create a login; it may never write to one — otherwise forwarding the email would be account takeover.',
  },
  {
    title: 'Somebody changes plan',
    icon: 'credit-card',
    steps: [
      { label: 'They ask', detail: 'From their billing page', file: 'PlanChangeRequest.jsx' },
      { label: 'A ticket is raised', detail: 'So it sits in the same queue as everything else', file: 'billing.routes.js' },
      { label: 'You invoice', detail: 'At the plan’s own price — Stripe emails it', file: 'PlanRequestPanel.jsx' },
      { label: 'They pay', detail: 'Stripe confirms it, nobody else', file: 'Stripe' },
      { label: 'The ticket says so', detail: 'Posted on the thread, and back into the queue', file: 'billing.routes.js' },
      { label: 'You apply the plan', detail: 'By hand, with the dates it should run between', file: 'AdminUserDetail.jsx' },
    ],
    rule: 'The amount is never typed — it is read from Stripe, so an invoice and the plan cards cannot disagree. Nothing marks a request paid except Stripe; the customer’s own word is not evidence. The plan itself is applied by hand, because an invoice says what was paid and nothing about the dates the new plan should run between.',
  },
  {
    title: 'Somebody asks for help',
    icon: 'mail',
    steps: [
      { label: 'Signed in, or not', detail: 'A guest gives a name, an address and a captcha', file: 'Support.jsx' },
      { label: 'Ticket raised', detail: 'With a reference they can quote', file: 'support.routes.js' },
      { label: 'Somebody takes it', detail: 'Only the holder can reply', file: 'adminSupport.routes.js' },
      { label: 'Replies both ways', detail: 'Emailed, but never quoting what was written', file: 'mailer.js' },
      { label: 'Closed', detail: 'Reopenable by either side', file: 'support.routes.js' },
    ],
    rule: 'The reference is never the row id. “Ticket 3” tells a customer they are the third person ever to write in.',
  },
];

function Step({ step, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: 0 }}>
      <div
        style={{
          flex: '1 1 0',
          minWidth: 0,
          border: '1px solid var(--border)',
          borderRadius: 9,
          padding: '10px 12px',
          background: 'var(--bg-card)',
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>{step.label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{step.detail}</div>
        <div
          style={{
            fontSize: 10.5,
            fontFamily: 'ui-monospace, monospace',
            color: 'var(--text-muted)',
            marginTop: 5,
            opacity: 0.75,
          }}
        >
          {step.file}
        </div>
      </div>
      {!last && (
        <div
          aria-hidden="true"
          style={{ display: 'flex', alignItems: 'center', padding: '0 6px', color: 'var(--text-muted)', flexShrink: 0 }}
        >
          <Icon name="arrow-right" size={15} />
        </div>
      )}
    </div>
  );
}

function Flow({ flow }) {
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name={flow.icon} size={16} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 800, fontSize: 15 }}>{flow.title}</span>
      </div>

      {/* Wraps rather than scrolls. A flow you have to drag sideways to finish
          reading is one nobody finishes reading. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 0', alignItems: 'stretch' }}>
        {flow.steps.map((step, i) => (
          <div key={step.label} style={{ flex: '1 1 190px', minWidth: 170, display: 'flex' }}>
            <Step step={step} last={i === flow.steps.length - 1} />
          </div>
        ))}
      </div>

      {flow.branch && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          {[flow.branch.left, flow.branch.right].map((side) => (
            <div
              key={side.label}
              style={{
                border: '1px solid var(--border)',
                borderLeft: '3px solid var(--accent)',
                borderRadius: 9,
                padding: '10px 12px',
                background: 'var(--bg-subtle)',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>{side.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{side.detail}</div>
              <div style={{ fontSize: 10.5, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)', marginTop: 5, opacity: 0.75 }}>
                {side.file}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The rule each flow exists to protect. These are the things that would
          be quietly broken by a reasonable-looking change, so they are written
          where somebody deciding on one can see them. */}
      <div
        style={{
          display: 'flex',
          gap: 9,
          alignItems: 'flex-start',
          padding: '10px 12px',
          borderRadius: 9,
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
        }}
      >
        <Icon name="shield" size={14} style={{ color: 'var(--emerald)', flexShrink: 0, marginTop: 2 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{flow.rule}</span>
      </div>
    </div>
  );
}

export default function HowItWorksTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 620 }}>
        The four things that happen in Taxify, and the rule each one protects. The file under every step is where it
        actually happens — if a step here stops matching the code, that is the bug.
      </p>
      {FLOWS.map((flow) => (
        <Flow key={flow.title} flow={flow} />
      ))}
    </div>
  );
}
