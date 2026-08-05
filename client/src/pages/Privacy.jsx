import { LegalPage, Section, P, List } from '../components/LegalPage.jsx';

// A fixed date, not new Date(). The page used to stamp itself with today, so it
// claimed to have been revised every morning — which is the one thing a "last
// updated" line must never do. Change it by hand when the wording changes.
const UPDATED = '6 August 2026';

const SECTIONS = [
  'Who we are',
  'What we collect',
  'Why we collect it',
  'Who else sees it',
  'Cookies',
  'Where it is kept, and for how long',
  'Your accountant and your family',
  'Keeping it safe',
  'Your rights',
  'Children',
  'Changes to this policy',
  'Contact',
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={UPDATED}
      sections={SECTIONS}
      summary="Taxify holds your financial records, so the short version matters: we collect what the app needs to work, we never sell it, we show you no advertising, and we run no tracking of any kind. The only people who see your records are you, anyone you deliberately invite, and the handful of services listed below that we need to take a payment or send an email."
    >
      <Section n={1} title="Who we are">
        <P>
          Taxify is an expense and receipt record-keeping service operated by Mikes App Hub. In this policy “we”
          and “us” mean Mikes App Hub, and “you” means the person whose account it is.
        </P>
        <P>
          We handle personal information in line with the Australian Privacy Principles under the Privacy Act 1988
          (Cth). If you use Taxify from outside Australia, your information is still stored and handled in Australia.
        </P>
      </Section>

      <Section n={2} title="What we collect">
        <P>Three kinds of thing, and nothing beyond them:</P>
        <List
          items={[
            <>
              <strong>Your account details.</strong> Your name, email address, and — where you give them — your phone
              number, date of birth, country and state, preferred currency, business name, and profile picture. Your
              country and state set which financial year your records are filed against, which is why they cannot be
              changed once you have started recording.
            </>,
            <>
              <strong>The records you keep.</strong> Expenses and their amounts, dates, currencies, categories and
              notes; receipts and property documents you upload; vehicle trips and home-office hours; and what you
              record about each tax year, including a refund amount and any appointment you enter.
            </>,
            <>
              <strong>Technical information about signing in.</strong> The time of each sign-in, the IP address it
              came from, the kind of device, the operating system and browser, and whether a code was emailed. If you
              install the Android app and allow notifications, a device token so notifications can reach it.
            </>,
          ]}
        />
        <P>
          We do not collect your card number. Payments go directly to Stripe, and we never see or store card details.
        </P>
      </Section>

      <Section n={3} title="Why we collect it">
        <P>
          To run the service you have asked for: to store and organise your records, convert foreign amounts, produce
          your reports and exports, and let an accountant you choose read them. To keep the account secure — the
          sign-in history exists so that “was that really me?” has an answer. To take payment and to email you about
          your account, your trial, and reminders you have asked for.
        </P>
        <P>
          We do not profile you, we do not use your records to train anything, and we do not send marketing you have
          not asked for.
        </P>
      </Section>

      <Section n={4} title="Who else sees it">
        <List
          items={[
            <>
              <strong>Stripe</strong> — to take and manage subscription payments. Stripe receives your email address
              and payment details and handles them under its own privacy policy.
            </>,
            <>
              <strong>Our email provider</strong> — to deliver sign-in codes, reminders and account notices.
            </>,
            <>
              <strong>Google Firebase</strong> — only if push notifications are switched on, and only ever a device
              token and the text of the notification itself. Never your records.
            </>,
            <>
              <strong>An exchange rate service</strong> — when you record an expense in another currency we look up
              the published rate for that date. We send only a date and two currency codes; nothing about you or the
              expense leaves the server.
            </>,
            <>
              <strong>Anyone you invite</strong> — an accountant, or a second person on a Family plan. See section 7.
            </>,
          ]}
        />
        <P>
          We do not sell personal information, we do not share it for advertising, and we will not hand it to anyone
          else unless the law requires it.
        </P>
      </Section>

      <Section n={5} title="Cookies">
        <P>
          One cookie, and it exists so you stay signed in. It holds a signed token, is marked HTTP-only so no script
          can read it, and is sent only to Taxify. Ticking “this is a shared device” at sign-in makes it disappear
          when you close the browser instead of lasting 30 days.
        </P>
        <P>There are no analytics cookies, no advertising cookies, and no third-party trackers on any page.</P>
      </Section>

      <Section n={6} title="Where it is kept, and for how long">
        <P>
          Your records live on servers operated by Mikes App Hub in Australia. Uploaded receipts and documents are
          stored as files on the same servers, filed under your account.
        </P>
        <List
          items={[
            'Records are kept while your account is open, because the point of the service is that last year is still there.',
            'A deleted expense leaves the app immediately and is removed permanently after 30 days.',
            'A sign-up that is never activated is deleted after five days.',
            'Accountant access is deleted automatically when its window ends.',
            'Sign-in history is kept while the account is open, as a security record.',
          ]}
        />
        <P>
          If you close your account we delete your records and your uploaded files. Ask us and we will confirm when it
          is done.
        </P>
      </Section>

      <Section n={7} title="Your accountant and your family">
        <P>
          When you invite an accountant you are choosing to show them your records. Their access is read-only, limited
          to the financial years you pick, and lasts only for the window you choose — after which it is removed
          automatically. You can revoke it at any time, and we tell you the first time they open your books.
        </P>
        <P>
          A second person on a Family plan is different: they share the account fully and permanently, and neither of
          you can remove the other. Only we can, at the account holder’s request.
        </P>
      </Section>

      <Section n={8} title="Keeping it safe">
        <P>
          Passwords are stored only as a one-way hash — we cannot read yours, and neither can anyone who obtains the
          database. Two-factor sign-in by emailed code is available to everyone and required of anyone acting as an
          accountant. Traffic is encrypted in transit. Uploads are restricted by type and served in a way that stops
          them executing in your browser.
        </P>
        <P>
          No system is perfect. If a breach ever affects your information we will tell you and the Office of the
          Australian Information Commissioner, as the Notifiable Data Breaches scheme requires.
        </P>
      </Section>

      <Section n={9} title="Your rights">
        <P>
          You can see everything we hold about you inside the app, and correct most of it yourself from your account
          settings. Reports lets you export your records as a spreadsheet, a PDF, or a full archive with the original
          receipt files — that export is yours to keep and does not need our involvement.
        </P>
        <P>
          To have your account and everything in it deleted, or if you think something we hold is wrong and you cannot
          change it yourself, email us and we will act on it. If you are unhappy with how we have handled a privacy
          matter you may complain to the Office of the Australian Information Commissioner at oaic.gov.au.
        </P>
      </Section>

      <Section n={10} title="Children">
        <P>Taxify is for adults managing their own tax affairs. It is not intended for anyone under 18.</P>
      </Section>

      <Section n={11} title="Changes to this policy">
        <P>
          If we change how we handle your information we will update this page and change the date at the top. If a
          change matters — a new service seeing your records, say — we will tell you rather than leaving you to notice.
        </P>
      </Section>

      <Section n={12} title="Contact">
        <P>
          Privacy questions, corrections and deletion requests all go to the same place: the support address shown in
          your account, or through mikesapphub.com.
        </P>
      </Section>
    </LegalPage>
  );
}
