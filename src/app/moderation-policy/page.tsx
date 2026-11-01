import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata(
  'Moderation Policy',
  'What our AI moderator does, what it does not do, and how to appeal.',
  '/moderation-policy',
);

export default function ModerationPage() {
  return (
    <LegalPage title="Moderation Policy" updated="November 2026">
      <h2>1. What the AI does</h2>
      <ul>
        <li>Transcribes each 2-second chunk and watches the video for rule-relevant visuals.</li>
        <li>Applies the comedian&apos;s own house rules plus the community guidelines.</li>
        <li>Takes minimal action: mute the offending word, blur the offending region. Never cuts the stream.</li>
        <li>Logs every decision with a short reason the comedian can see live.</li>
      </ul>
      <h2>2. What the AI does not do</h2>
      <ul>
        <li>It does not judge funniness, taste, or politics.</li>
        <li>It does not ban accounts, delete shows, or contact authorities on its own.</li>
        <li>It does not store recordings; chunks exist in memory for the broadcast delay, then are gone.</li>
        <li>It is not perfect: satire can be misread and real attacks can slip through.</li>
      </ul>
      <h2>3. Humans decide the hard cases</h2>
      <p>
        Account-level actions (suspension, takedown) are taken by humans after review, never by the
        live pipeline alone. Severe-safety categories are escalated to human reviewers with the
        relevant log excerpt.
      </p>
      <h2>4. Appeals</h2>
      <p>
        Comedians and viewers can appeal any moderation outcome via /contact. Include the show, the
        approximate time, and what you believe was wrong. We aim to answer within 3 business days;
        upheld appeals retrain our rules and, where possible, restore the unmodified segment for
        ticket holders.
      </p>
    </LegalPage>
  );
}
