import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata(
  'Terms of Service',
  'The rules for using Comedically Online.',
  '/terms',
);

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="November 2026">
      <h2>1. The service</h2>
      <p>
        Comedically Online (“we”) runs a live stand-up streaming platform. Comedians perform live
        shows; viewers buy (mock, during the test phase) tickets and watch with a short broadcast
        delay. By creating an account you agree to these terms.
      </p>
      <h2>2. Eligibility</h2>
      <p>
        You must be 18 or older to register, perform, or purchase. We ask for an 18+ confirmation at
        signup; shows may contain adult humor.
      </p>
      <h2>3. Accounts</h2>
      <ul>
        <li>One account per person. Keep your password secret; you are responsible for activity on your account.</li>
        <li>Comedian profiles (stage name, bio) must not impersonate real people.</li>
        <li>We may suspend accounts that breach these terms or the community guidelines.</li>
      </ul>
      <h2>4. Tickets and mock payments</h2>
      <p>
        During the test phase all payments are MOCK: no money moves and no card data is collected or
        stored. Tickets grant access to a single show for the account holder and are non-transferable.
      </p>
      <h2>5. Content and conduct</h2>
      <ul>
        <li>Comedians own their performances and grant us a license to stream them to ticket holders.</li>
        <li>Streams pass through automated moderation (see the moderation policy). The stream is never cut; flagged words or regions are muted or blurred in place.</li>
        <li>Recording or redistributing shows without permission is prohibited.</li>
      </ul>
      <h2>6. Availability</h2>
      <p>
        This is a test build: uptime, stream quality, and moderation accuracy are not guaranteed. We
        may change or discontinue features at any time.
      </p>
      <h2>7. Liability</h2>
      <p>
        To the maximum extent permitted by law, the service is provided “as is” without warranties.
        [PLACEHOLDER: governing law, dispute resolution, and liability caps to be set by counsel.]
      </p>
    </LegalPage>
  );
}
