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
      left: {
        label: 'No confirmed account',
        detail: 'Emailed how to sign up. Nothing is created and no invitation exists',
        file: 'mailer.js',
      },
      right: {
        label: 'Confirmed account',
        detail: 'Invited. Opening the link is what grants it',
        file: 'accountantInvites.js',
      },
    },
    steps: [
      { label: 'Client enters an email', detail: 'And which books, which years, read or write', file: 'Account.jsx' },
      { label: 'We look it up', detail: 'Registered and verified, or not — two branches from here', file: 'auth.routes.js' },
      { label: 'They open the link', detail: 'Signed in as that address, one press. 24 hours to do it', file: 'AcceptInvite.jsx' },
      { label: 'Access granted', detail: 'One assignment row, scoped to what was chosen', file: 'accountants.js' },
      { label: 'Clock starts on first open', detail: 'Not on acceptance — an unopened window is not spent', file: 'accountants.js' },
    ],
    rule: 'An invitation links an account and never creates one. An address with no confirmed account is told to sign up and the client is told to ask again — because a live link against an unclaimed address would hand somebody\u2019s tax records to whoever registered it first. Nothing is granted until the link is opened: recognising an address is not the same as the person at it agreeing.',
  },
  {
    title: 'Somebody changes plan',
    icon: 'credit-card',
    steps: [
      { label: 'They ask', detail: 'From their billing page', file: 'Account.jsx' },
      { label: 'A ticket is raised', detail: 'So it sits in the same queue as everything else', file: 'billing.routes.js' },
      { label: 'You invoice', detail: 'At the plan’s own price — Stripe emails it', file: 'PlanRequestPanel.jsx' },
      { label: 'Wrong one? Withdraw it', detail: 'Voided in Stripe, request back to pending, re-invoice', file: 'admin.routes.js' },
      { label: 'They pay', detail: 'Stripe confirms it, nobody else', file: 'Stripe' },
      { label: 'The ticket says so', detail: 'Posted on the thread, and back into the queue', file: 'billing.routes.js' },
      { label: 'You apply the plan', detail: 'By hand, with the dates it should run between', file: 'AdminUserDetail.jsx' },
    ],
    rule: 'The amount is never typed — it is read from Stripe, so an invoice and the plan cards cannot disagree. Cancelling or withdrawing voids the bill in Stripe first: a cancelled request with a live invoice behind it is how somebody pays for a plan change nobody is going to grant. Asking for a different plan supersedes the earlier request and voids its invoice, so there are never two live at once. Nothing marks a request paid except Stripe; the customer’s own word is not evidence. The plan itself is applied by hand, because an invoice says what was paid and nothing about the dates the new plan should run between.',
  },
  {
    title: 'A plan runs out, or renews',
    icon: 'repeat',
    steps: [
      { label: 'Reminders go out', detail: 'Trial at 7, 3 and 1 days; renewal at 7 and 1', file: 'billingJobs.js' },
      { label: 'Stripe charges the card', detail: 'For anybody with a live subscription — nothing for us to do', file: 'Stripe' },
      { label: 'The period extends itself', detail: 'The subscription webhook writes the new end date', file: 'billing.routes.js' },
      { label: 'Or it lapses', detail: 'Access locks. Their records are untouched and still theirs', file: 'access.js' },
      { label: 'They renew', detail: 'Same plan is an ordinary checkout — no ticket, no waiting', file: 'SubscriptionRequired.jsx' },
      { label: 'Or they move', detail: 'A different plan raises a request, and that needs a person', file: 'Account.jsx' },
    ],
    rule: 'Renewing and changing are not the same job. Renewing needs nobody: same plan, published price, a card Stripe already holds. Changing needs somebody, because the price and the dates have to be decided. Sending both down the same road is what left a lapsed customer waiting on a human to take money Stripe could have taken unattended.',
  },
  {
    title: 'Somebody asks for help',
    icon: 'mail',
    steps: [
      { label: 'Signed in, or not', detail: 'A guest gives a name, an address and a captcha', file: 'Support.jsx' },
      { label: 'Or we start it', detail: 'Support raises one for them — assigned to whoever wrote it', file: 'adminSupport.routes.js' },
      { label: 'Ticket raised', detail: 'With a reference they can quote', file: 'support.routes.js' },
      { label: 'Somebody takes it', detail: 'Only the holder can reply', file: 'adminSupport.routes.js' },
      { label: 'Replies both ways', detail: 'Emailed, but never quoting what was written', file: 'mailer.js' },
      { label: 'Closed', detail: 'Reopenable by either side', file: 'support.routes.js' },
    ],
    rule: 'The reference is never the row id. “Ticket 3” tells a customer they are the third person ever to write in.',
  },
  {
    title: 'You take the site offline',
    icon: 'wrench',
    steps: [
      { label: 'You throw the switch', detail: 'Maintenance, or technical difficulties — the notice differs', file: 'Admin.jsx' },
      { label: 'Confirmed first', detail: 'The dialog says what happens, both turning it off and back on', file: 'Admin.jsx' },
      { label: 'Everyone else is stopped', detail: 'On their next request, without reloading', file: 'maintenanceGate.js' },
      { label: 'Staff carry on', detail: 'Admins and support see the app plus a red banner', file: 'MaintenanceBoundary.jsx' },
      { label: 'Sign-in stays open', detail: 'Login and the second factor keep working', file: 'maintenance.js' },
      { label: 'Back on', detail: 'Anyone sitting on the notice is let in within half a minute', file: 'MaintenanceScreen.jsx' },
    ],
    rule: 'It is off unless somebody switched it on — the opposite default to everything else here, because a missing row or a half-run migration must leave the site up rather than down. The paths that keep working are an exact list, not a rule of thumb: without login and the second factor on it, the switch would be a way to lock yourself out of your own site permanently. Registration and password reset are deliberately not on it, since an account created during an outage cannot be activated.',
  },
  {
    title: 'You release an Android build',
    icon: 'phone',
    steps: [
      { label: 'Build it signed', detail: 'The same keystore every time, or it will not update in place', file: 'build.gradle' },
      { label: 'Drop the APK in', detail: 'client/public/downloads, so a deploy carries it', file: 'app.routes.js' },
      { label: 'Say what it is', detail: 'versionCode and versionName in app-version.json', file: 'app-version.json' },
      { label: 'Phones ask on resume', detail: 'They compare against their own build', file: 'UpdateManager.java' },
      { label: 'Offered, or required', detail: 'Below minVersionCode there is no Later button', file: 'UpdateManager.java' },
    ],
    rule: 'The version people are offered comes from app-version.json, not from the file on disk — so a build that ships without that number being raised is a build nobody is ever told about, which is exactly what happened between versions 7 and 9. minVersionCode is the floor below which a build must not go on being used; set it only when the old one gets something actively wrong, because an installer forced on somebody for a change of wording is contempt for their time. The signing certificate must not change: a different one cannot update an installed app and silently breaks every app link.',
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
