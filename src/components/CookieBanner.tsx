'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/** Essential-cookies-only banner. Dismissal is stored locally, nothing tracked. */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      if (!window.localStorage.getItem('cookie-ok')) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss(): void {
    try {
      window.localStorage.setItem('cookie-ok', '1');
    } catch {
      // private mode: banner just hides for this visit
    }
    setVisible(false);
  }

  if (!visible) return null;
  return (
    <div role="dialog" aria-label="Cookie notice" className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-xl rounded-md border border-neutral-700 bg-neutral-900 p-4 shadow-xl sm:left-auto sm:right-6">
      <p className="text-sm text-neutral-300">
        We use essential cookies only (login session, ticket access). No analytics, no ads.{' '}
        <Link href="/cookies" className="underline">
          Details
        </Link>
      </p>
      <button onClick={dismiss} className="mt-3 rounded-md bg-spotlight px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110">
        Got it
      </button>
    </div>
  );
}
