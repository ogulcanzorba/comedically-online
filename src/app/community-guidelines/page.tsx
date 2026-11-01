import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata(
  'Community Guidelines',
  'How to keep the room fun for everyone.',
  '/community-guidelines',
);

export default function GuidelinesPage() {
  return (
    <LegalPage title="Community Guidelines" updated="November 2026">
      <h2>1. Punch up, not down</h2>
      <p>
        Comedy thrives on surprise, not cruelty. Jokes that demean people for protected
        characteristics (race, religion, gender, sexuality, disability, and similar) may be muted or
        blurred, even when you meant them as satire. The judge reads context — help it by aiming at
        power, not at vulnerable people.
      </p>
      <h2>2. No-go areas</h2>
      <ul>
        <li>Real-world harassment, threats, or doxxing of any person (including hecklers).</li>
        <li>Sexual content involving minors, in any form, zero tolerance.</li>
        <li>Showing private information on screen (addresses, IDs, other people&apos;s messages).</li>
        <li>Hate symbols, extremist propaganda, or encouragement of self-harm.</li>
      </ul>
      <h2>3. House rules matter</h2>
      <p>
        Comedians set plain-language house rules per show (“bleep my ex&apos;s name”). The moderator
        follows them on top of these baseline guidelines.
      </p>
      <h2>4. Enforcement</h2>
      <p>
        Live enforcement is soft by design: words are bleeped, regions blurred, the show goes on.
        Repeated or severe violations can lead to show takedown or account suspension, always with a
        right to appeal (see the moderation policy).
      </p>
    </LegalPage>
  );
}
