import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata(
  'Privacy Policy',
  'What data Comedically Online collects and why.',
  '/privacy',
);

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="November 2026">
      <h2>1. Data we collect</h2>
      <ul>
        <li>Account data: email, password hash (bcrypt, never plaintext), display/stage name, bio, country.</li>
        <li>Show data: titles, descriptions, schedules, ticket tiers you create or buy.</li>
        <li>Technical data: login timestamps, rate-limit counters, essential session cookie.</li>
        <li>Stream media is processed in memory for moderation and broadcast delay, then discarded; we do not retain recordings in this build.</li>
      </ul>
      <h2>2. What we do NOT collect</h2>
      <p>
        No card numbers (mock checkout never transmits them), no analytics beacons, no advertising
        identifiers, no sale of personal data.
      </p>
      <h2>3. Why we process data (GDPR/KVKK-aware)</h2>
      <ul>
        <li>Contract: run accounts, tickets, and streams you asked for.</li>
        <li>Legitimate interests: security (rate limits), preventing abuse, debugging.</li>
        <li>Consent: the 18+ confirmation and essential-cookie notice where required.</li>
      </ul>
      <h2>4. Your rights</h2>
      <p>
        Depending on your jurisdiction (including GDPR and Türkiye&apos;s KVKK), you may have rights to
        access, correct, delete, restrict, port, or object to processing of your data, and to
        withdraw consent. Contact us (see /contact) and we will respond within the statutory period.
        [PLACEHOLDER: data controller identity, DPO, supervisory authority, retention schedule.]
      </p>
      <h2>5. Retention and security</h2>
      <p>
        Accounts and tickets persist until you ask for deletion. Passwords are bcrypt-hashed, sessions
        are signed httpOnly cookies, and stream chunks live only in memory. No system is perfectly
        secure; report issues via /contact.
      </p>
      <h2>6. International transfers</h2>
      <p>
        AI moderation calls may be processed by model providers in other countries. [PLACEHOLDER:
        transfer mechanism and sub-processor list to be confirmed by counsel.]
      </p>
    </LegalPage>
  );
}
