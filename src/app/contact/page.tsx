import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata(
  'Contact',
  'Reach the Comedically Online team.',
  '/contact',
);

export default function ContactPage() {
  return (
    <LegalPage title="Contact" updated="November 2026">
      <h2>Support</h2>
      <p>
        Demo build — the fastest way to reach us is email:{' '}
        <a className="underline" href="mailto:support@comedically.example.com">
          support@comedically.example.com
        </a>{' '}
        (fictional address for the test phase). We read everything on weekdays, Europe/Istanbul
        mornings.
      </p>
      <h2>Appeals and safety</h2>
      <p>
        For moderation appeals include the show name, the approximate show time, and one sentence on
        what went wrong. For urgent safety issues (doxxing, threats), put URGENT in the subject and
        we triage first.
      </p>
      <h2>Comedians</h2>
      <p>
        Onboarding questions, payout questions (mock phase: there are no real payouts yet), and
        feature requests all go to the same inbox for now.
      </p>
    </LegalPage>
  );
}
