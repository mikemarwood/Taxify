import { LegalPage, Section, P, List } from '../components/LegalPage.jsx';

// Fixed by hand, not new Date() — see the note in Privacy.jsx.
const UPDATED = '6 August 2026';

const SECTIONS = [
  'What Taxify is, and what it is not',
  'Your account',
  'Free trial and subscription',
  'Cancelling and refunds',
  'Your records belong to you',
  'Keeping your own copies',
  'Sharing access with your accountant',
  'What you agree not to do',
  'Availability',
  'Our responsibility to you',
  'Ending your account',
  'Changes to these terms',
  'Governing law',
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      updated={UPDATED}
      sections={SECTIONS}
      summary="Taxify keeps a tidy record of what you spent and the receipts that prove it. It is a record-keeping tool, not a tax adviser — it does not decide what you may claim, and it does not file anything on your behalf. What you or your accountant put in a return remains yours to stand behind."
    >
      <Section n={1} title="What Taxify is, and what it is not">
        <P>
          Taxify records expenses, stores receipts, applies the financial year rules for your country, converts
          foreign amounts, and produces reports and archives you can hand to an accountant.
        </P>
        <P>
          <strong>It is not tax, accounting, financial or legal advice.</strong> Whether an expense is deductible,
          what percentage of it was business use, which filing period it belongs in and what you finally claim are
          your decisions, or your accountant’s. The deduction rates the app uses are entered by an administrator and
          should be checked against current guidance from your tax authority before you rely on them.
        </P>
        <P>Taxify does not lodge returns, does not communicate with any tax authority, and is not affiliated with one.</P>
      </Section>

      <Section n={2} title="Your account">
        <P>
          You need to be at least 18 and to give accurate details when you register. Your country and state set which
          financial year your records are filed against, so they are fixed once you begin — everything you record is
          filed against them.
        </P>
        <P>
          Keep your password to yourself and use two-factor sign-in where you can. You are responsible for what
          happens under your login. Tell us promptly if you think someone else has been in it — your account settings
          show every recent sign-in, with the device and the address it came from.
        </P>
      </Section>

      <Section n={3} title="Free trial and subscription">
        <P>
          Every plan begins with a 14-day free trial. No card is needed to start it, and if you do nothing at the end
          of it the account simply stops being usable — you are never charged automatically off the back of a trial.
        </P>
        <P>
          After the trial, continued use needs a paid subscription. Plans are billed once a year in advance through
          Stripe, at the price shown when you subscribe. We will tell you before a renewal is taken. If we change our
          prices, the new price applies from your next renewal, never mid-term.
        </P>
      </Section>

      <Section n={4} title="Cancelling and refunds">
        <P>
          You can cancel at any time from your account. Cancelling stops the next renewal; your subscription runs to
          the end of the period you have already paid for, and we do not pro-rate a partial year.
        </P>
        <P>
          Even after a subscription ends, <strong>nothing you recorded is deleted</strong>. Your records stay where
          they are and become readable again the moment you subscribe.
        </P>
        <P>
          Nothing in this section limits your rights under the Australian Consumer Law. If the service is faulty or
          not as described, you may be entitled to a refund, and these terms do not take that away.
        </P>
      </Section>

      <Section n={5} title="Your records belong to you">
        <P>
          Everything you put into Taxify — expenses, categories, receipts, documents — stays yours. You give us
          permission to store and process it only so far as running the service requires: holding it, backing it up,
          converting currencies, generating your reports, and showing it to anyone you have invited.
        </P>
        <P>
          We claim no other right to it. We do not use it to train anything, we do not analyse it for our own
          purposes, and we do not show it to anyone you have not chosen.
        </P>
      </Section>

      <Section n={6} title="Keeping your own copies">
        <P>
          Taxify is a convenience, not your only copy. In Australia you are generally required to keep tax records for
          five years, and that obligation is yours regardless of what any software does.
        </P>
        <P>
          Reports will produce a full archive — a spreadsheet, a PDF summary and every original receipt file — that you
          can download and keep. Download one at the end of each financial year. We take reasonable care of your data,
          but no service should be the only place a legally required record exists.
        </P>
      </Section>

      <Section n={7} title="Sharing access with your accountant">
        <P>
          Inviting an accountant gives them read-only access to the financial years you choose, for a window you
          choose, starting the first time they open your books and ending automatically afterwards. You can revoke it
          at any time, and we tell you when they first open it. They may record a refund figure and an appointment for
          you — nothing else can be changed.
        </P>
        <P>
          One person to an account. If somebody else needs to keep their own records — a partner with their own job,
          for instance — they need their own account, because their tax return is their own and cannot share yours.
        </P>
        <P>Whoever you invite, you are responsible for having chosen to share your records with them.</P>
      </Section>

      <Section n={8} title="What you agree not to do">
        <List
          items={[
            'Use Taxify for anything unlawful, including to record or disguise something you know to be false.',
            'Share your login, or use someone else’s.',
            'Upload anything harmful, or anything you do not have the right to store.',
            'Try to break into, overload, scrape or reverse-engineer the service.',
            'Resell access to Taxify or present it as your own product.',
          ]}
        />
      </Section>

      <Section n={9} title="Availability">
        <P>
          We aim to keep Taxify running and to make maintenance brief and unremarkable. We do not promise
          uninterrupted service, and occasionally something will be unavailable — through our own fault, a hosting
          provider, or something outside anyone’s control.
        </P>
        <P>
          The Android app is a window onto the same service and needs a connection. Google and Apple make no promises
          about it either.
        </P>
      </Section>

      <Section n={10} title="Our responsibility to you">
        <P>
          Taxify is provided as it is. To the extent the law allows, we are not liable for indirect or consequential
          loss, and our total liability for any claim is limited to what you paid us in the twelve months before it
          arose.
        </P>
        <P>
          In particular we are not responsible for a tax outcome — a claim disallowed, a penalty, interest, or an
          amount you did not claim because it was not recorded. Those follow from what was put in a return, which is
          yours or your accountant’s to decide.
        </P>
        <P>
          Our goods and services come with guarantees that cannot be excluded under the Australian Consumer Law.
          Nothing above limits those, and where liability cannot be excluded it is limited to resupplying the service
          or paying the cost of doing so.
        </P>
      </Section>

      <Section n={11} title="Ending your account">
        <P>
          You may close your account at any time by asking us. We will delete your records and your uploaded files,
          and confirm when it is done. Export anything you want to keep first — after deletion we cannot get it back.
        </P>
        <P>
          We may suspend or close an account that breaches these terms, or where payment fails and is not put right
          after we have told you. Except in serious cases we will give you notice and a chance to export your records.
        </P>
      </Section>

      <Section n={12} title="Changes to these terms">
        <P>
          We may update these terms. The date at the top changes when we do, and we will tell you about anything
          significant rather than leaving you to spot it. Continuing to use Taxify after a change means you accept it;
          if you do not, you may cancel.
        </P>
      </Section>

      <Section n={13} title="Governing law">
        <P>
          These terms are governed by the laws of Western Australia, and by the courts of Western Australia — which
          does not take away any right you have to bring a matter where you live.
        </P>
      </Section>
    </LegalPage>
  );
}
