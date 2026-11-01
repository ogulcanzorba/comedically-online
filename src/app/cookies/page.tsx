import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata(
  'Cookie Policy',
  'Essential cookies only. No tracking.',
  '/cookies',
);

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="November 2026">
      <h2>1. What we set</h2>
      <ul>
        <li>
          <strong>comedically_session</strong> — signed, httpOnly login session. Required to stay logged
          in and to prove ticket ownership. Expires after 7 days.
        </li>
      </ul>
      <h2>2. What we do not set</h2>
      <p>
        No analytics cookies, no advertising cookies, no cross-site trackers, no social pixels. The
        cookie banner&apos;s dismissal is stored in your browser&apos;s local storage, not in a cookie.
      </p>
      <h2>3. Managing cookies</h2>
      <p>
        Blocking the session cookie in your browser will log you out and prevent ticketed viewing, but
        public pages (shows, categories, legal) keep working. Clearing cookies has the same effect as
        logging out.
      </p>
    </LegalPage>
  );
}
